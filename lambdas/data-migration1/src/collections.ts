import Knex from 'knex';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import { envUtils } from '@cumulus/common';
import { CollectionRecord } from '@cumulus/db';
import Logger from '@cumulus/logger';

import { RecordAlreadyMigrated } from './errors';
import { MigrationSummary } from './types';

const Manager = require('@cumulus/api/models/base');
const schemas = require('@cumulus/api/models/schemas');

const logger = new Logger({ sender: '@cumulus/data-migration/collections' });

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
): Promise<void> => {
  // Use API model schema to validate record before processing
  Manager.recordIsValid(dynamoRecord, schemas.collection);

  const existingRecord = await knex<CollectionRecord>('collections')
    .where({
      name: dynamoRecord.name,
      version: dynamoRecord.version,
    })
    .first();
  // Throw error if it was already migrated.
  if (existingRecord) {
    throw new RecordAlreadyMigrated(`Collection name ${dynamoRecord.name}, version ${dynamoRecord.version} was already migrated, skipping`);
  }

  // Map old record to new schema.
  const updatedRecord: CollectionRecord = {
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

  await knex('collections').insert(updatedRecord);
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
