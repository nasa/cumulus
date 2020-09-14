import AWS from 'aws-sdk';
import Knex from 'knex';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import { getKnexClient } from '@cumulus/db';
import { envUtils } from '@cumulus/common';
import { createErrorType } from '@cumulus/errors';
import Logger from '@cumulus/logger';

const Manager = require('@cumulus/api/models/base');
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

interface MigrationSummary {
  dynamoRecords: number
  success: number
  skipped: number
  failed: number
}

export const RecordAlreadyMigrated = createErrorType('RecordAlreadyMigrated');

/**
 * Migrate collection record from Dynamo to RDS.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} dynamoRecord
 *   Source record from DynamoDB
 * @param {Knex} knex - Knex client for writing to RDS database
 * @returns {Promise<number>} - Cumulus ID for record
 * @throws {RecordAlreadyMigrated}
 *   if record was already migrated
 */
export const migrateCollectionRecord = async (
  dynamoRecord: AWS.DynamoDB.DocumentClient.AttributeMap,
  knex: Knex
): Promise<number> => {
  // Use API model schema to validate record before processing
  Manager.recordIsValid(dynamoRecord, schemas.collection);

  const [existingRecord] = await knex('collections')
    .where('name', dynamoRecord.name)
    .where('version', dynamoRecord.version);
  // Throw error if it was already migrated.
  if (existingRecord) {
    throw new RecordAlreadyMigrated(`Collection name ${dynamoRecord.name}, version ${dynamoRecord.version} was already migrated, skipping`);
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
  return cumulusId;
};

export const migrateCollections = async (
  env: NodeJS.ProcessEnv,
  knex: Knex
): Promise<MigrationSummary> => {
  const collectionsTable = envUtils.getRequiredEnvVar('CollectionsTable', env);

  const searchQueue = new DynamoDbSearchQueue({
    TableName: collectionsTable,
  });

  const migrationSummary = {
    dynamoRecords: 0,
    success: 0,
    failed: 0,
    skipped: 0,
  };

  let record = await searchQueue.peek();
  /* eslint-disable no-await-in-loop */
  while (record) {
    migrationSummary.dynamoRecords += 1;

    try {
      await migrateCollectionRecord(record, knex);
      migrationSummary.success += 1;
    } catch (error) {
      if (error instanceof RecordAlreadyMigrated) {
        migrationSummary.skipped += 1;
        logger.info(error);
      } else {
        migrationSummary.failed += 1;
        logger.error(
          `Could not create collection record in RDS for Dynamo collection name ${record.name}, version ${record.version}:`,
          error
        );
      }
    }

    await searchQueue.shift();
    record = await searchQueue.peek();
  }
  /* eslint-enable no-await-in-loop */
  logger.info(`successfully migrated ${migrationSummary.success} collection records`);
  return migrationSummary;
};

export const handler = async (event: HandlerEvent): Promise<string> => {
  const env = event.env ?? process.env;

  const knex = await getKnexClient({ env });

  try {
    const collectionsMigrationSummary = await migrateCollections(env, knex);
    return `
      Migration summary:
        Collections:
          Out of ${collectionsMigrationSummary.dynamoRecords} Dynamo records:
            ${collectionsMigrationSummary.success} records migrated
            ${collectionsMigrationSummary.skipped} records skipped
            ${collectionsMigrationSummary.failed} records failed
    `;
  } finally {
    await knex.destroy();
  }
};
