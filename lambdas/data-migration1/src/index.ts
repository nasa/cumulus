import AWS from 'aws-sdk';
import Knex from 'knex';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import { connection } from '@cumulus/db';
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

/**
 * Migrate collection record from Dynamo to RDS.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} dynamoRecord
 *   Source record from DynamoDB
 * @param {Knex} knex - Knex client for writing to RDS database
 * @returns {number|false}
 *   New record ID on success, false if record was skipped
 */
export const migrateCollectionRecord = async (
  dynamoRecord: AWS.DynamoDB.DocumentClient.AttributeMap,
  knex: Knex
): Promise<number | false> => {
  // Use schema to validate record before processing
  Manager.recordIsValid(dynamoRecord, schemas.collection);

  const [existingRecord] = await knex('collections')
    .where('name', dynamoRecord.name)
    .where('version', dynamoRecord.version);
  // Skip record if it was already migrated.
  if (existingRecord) {
    logger.info(`Collection name ${dynamoRecord.name}, version ${dynamoRecord.version} was already migrated, skipping`);
    return false;
  }

  // Map old record to new schema.
  const updatedRecord: RDSCollectionRecord = {
    name: dynamoRecord.name,
    version: dynamoRecord.version,
    process: dynamoRecord.process,
    url_path: dynamoRecord.url_path,
    duplicateHandling: dynamoRecord.duplicateHandling,
    granuleIdValidationRegex: dynamoRecord.granuleId,
    granuleIdExtractionRegex: dynamoRecord.granuleIdExtraction,
    // have to stringify on an array of values
    files: JSON.stringify(dynamoRecord.files),
    reportToEms: dynamoRecord.reportToEms,
    sampleFileName: dynamoRecord.sampleFileName,
    ignoreFilesConfigForDiscovery: dynamoRecord.ignoreFilesConfigForDiscovery,
    meta: dynamoRecord.meta ? dynamoRecord.meta : undefined,
    // have to stringify on an array of values
    tags: dynamoRecord.tags ? JSON.stringify(dynamoRecord.tags) : undefined,
    created_at: new Date(dynamoRecord.createdAt),
    updated_at: new Date(dynamoRecord.updatedAt),
  };

  const [cumulusId] = await knex('collections')
    .returning('cumulusId')
    .insert(updatedRecord);
  return <number>cumulusId;
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
      const createdRecordId = await migrateCollectionRecord(record, knex);
      if (createdRecordId) createdRecordIds.push(createdRecordId);
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

export const handler = async (event: HandlerEvent): Promise<void> => {
  const env = event?.env ?? process.env;
  const knex = await connection.knex({ env });

  try {
    await migrateCollections(env, knex);
  } finally {
    await knex.destroy();
  }
};
