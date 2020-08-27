import Knex from 'knex';
import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import Logger from '@cumulus/logger';

const {
  Manager,
} = require('@cumulus/api/models');
const schemas = require('@cumulus/api/models/schemas');

const logger = new Logger({ sender: '@cumulus/data-migration' });

export interface HandlerEvent {
  env?: NodeJS.ProcessEnv
}

export interface RDSCollectionRecord {
  name: string
  version: string
  process: string
  granuleIdValidationRegex: string
  granuleIdExtractionRegex: string
  files: string
  // default will be set by schema validation
  duplicateHandling: string
  // default will be set by schema validation
  reportToEms: boolean
  sampleFileName?: string
  url_path?: string
  ignoreFilesConfigForDiscovery?: boolean
  meta?: object
  tags?: string
  created_at: Date
  updated_at: Date
}

const getRequiredEnvVar = (name: string, env: NodeJS.ProcessEnv): string => {
  const value = env?.[name];

  if (value) return value;

  throw new Error(`The ${name} environment variable must be set`);
};

export const migrateCollections = async (env: NodeJS.ProcessEnv, knex: Knex) => {
  const collectionsTable = getRequiredEnvVar('CollectionsTable', env);

  const searchQueue = new DynamoDbSearchQueue({
    TableName: collectionsTable,
  });
  const createdRecordIds = [];

  let record = await searchQueue.peek();
  /* eslint-disable no-await-in-loop */
  while (record) {
    try {
      // Use schema to validate record before processing
      Manager.recordIsValid(record, schemas.collection);

      // Map old record to new schema.
      const updatedRecord: RDSCollectionRecord = {
        name: record.name,
        version: record.version,
        process: record.process,
        url_path: record.url_path,
        duplicateHandling: record.duplicateHandling,
        granuleIdValidationRegex: record.granuleId,
        granuleIdExtractionRegex: record.granuleIdExtraction,
        // have to stringify on an array of values
        files: JSON.stringify(record.files),
        reportToEms: record.reportToEms,
        sampleFileName: record.sampleFileName,
        ignoreFilesConfigForDiscovery: record.ignoreFilesConfigForDiscovery,
        meta: record.meta ? record.meta : undefined,
        // have to stringify on an array of values
        tags: record.tags ? JSON.stringify(record.tags) : undefined,
        created_at: new Date(record.createdAt),
        updated_at: new Date(record.updatedAt),
      };

      const [cumulusId] = await knex('collections')
        .returning('cumulusId')
        .insert(updatedRecord);
      createdRecordIds.push(cumulusId);
    } catch (error) {
      logger.error('Could not create collection record:', error);
    }

    await searchQueue.shift();
    record = await searchQueue.peek();
  }
  /* eslint-enable no-await-in-loop */
  logger.info(`successfully migrated ${createdRecordIds.length} collection records`);
  return createdRecordIds;
};

const getConnectionConfig = (env: NodeJS.ProcessEnv): Knex.PgConnectionConfig => ({
  host: getRequiredEnvVar('PG_HOST', env),
  user: getRequiredEnvVar('PG_USER', env),
  // TODO Get this value from secrets manager
  password: getRequiredEnvVar('PG_PASSWORD', env),
  database: getRequiredEnvVar('PG_DATABASE', env),
});

export const handler = async (event: HandlerEvent): Promise<void> => {
  const env = event?.env ?? process.env;

  const knex = Knex({
    client: 'pg',
    connection: getConnectionConfig(env),
    debug: env?.KNEX_DEBUG === 'true',
    asyncStackTraces: env?.KNEX_ASYNC_STACK_TRACES === 'true',
  });

  try {
    await migrateCollections(env, knex);
  } finally {
    await knex.destroy();
  }
};
