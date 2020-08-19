import Knex from 'knex';
import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import Logger from '@cumulus/logger';

const logger = new Logger({ sender: '@cumulus/data-migration' });

export interface HandlerEvent {
  env?: NodeJS.ProcessEnv
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
    // TODO: use schema to validate record before processing

    // Map old record to new schema.
    // should not spread old record properties - should map the properties
    // i want directly
    const updatedRecord: any = {
      ...record,
      granuleIdValidationRegex: record.granuleId,
      files: JSON.stringify(record.files),
      meta: JSON.stringify(record.meta),
      created_at: new Date(record.createdAt),
      updated_at: new Date(record.updatedAt),
      tags: JSON.stringify(record.tags),
    };

    // Remove field names that do not exist in new schema
    delete updatedRecord.granuleId;
    delete updatedRecord.createdAt;
    delete updatedRecord.updatedAt;
    delete updatedRecord.dataType;

    try {
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
