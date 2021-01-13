import Knex from 'knex';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import {
  PostgresCollectionRecord,
  PostgresGranuleRecord,
  PostgresFileRecord,
  PostgresFile,
  getRecordCumulusId,
  tableNames,
} from '@cumulus/db';
import { envUtils } from '@cumulus/common';
import Logger from '@cumulus/logger';

import { RecordAlreadyMigrated } from '@cumulus/errors';
import { MigrationSummary } from './types';

const logger = new Logger({ sender: '@cumulus/data-migration/files' });
/**
 * Migrate files record from Dynamo to RDS.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} dynamoRecord
 *   Record from DynamoDB
 * @param {Knex} knex - Knex client for writing to RDS database
 * @returns {Promise<number>} - Cumulus ID for record
 * @throws {RecordAlreadyMigrated} if record was already migrated
 */
export const migrateFileRecord = async (
  dynamoRecord: AWS.DynamoDB.DocumentClient.AttributeMap,
  knex: Knex
): Promise<void> => {
  const [name, version] = dynamoRecord.collectionId.split('___');

  const collectionCumulusId = await getRecordCumulusId<PostgresCollectionRecord>(
    { name, version },
    tableNames.collections,
    knex
  );

  const granuleCumulusId = await getRecordCumulusId<PostgresGranuleRecord>(
    { granule_id: dynamoRecord.granuleId, collection_cumulus_id: collectionCumulusId },
    tableNames.executions,
    knex
  );

  const existingRecord = await knex<PostgresFileRecord>('files')
    .where({ bucket: dynamoRecord.bucket, key: dynamoRecord.key })
    .first();

  // Throw error if it was already migrated.
  if (existingRecord) {
    throw new RecordAlreadyMigrated(`File with bucket ${dynamoRecord.bucket} and key ${dynamoRecord.key} was already migrated, skipping`);
  }

  // Map old record to new schema.
  const updatedRecord: PostgresFile = {
    granule_cumulus_id: granuleCumulusId,
    file_size: dynamoRecord.size,
    bucket: dynamoRecord.bucket,
    checksum_type: dynamoRecord.checksumType,
    file_name: dynamoRecord.fileName,
    key: dynamoRecord.key,
    source: dynamoRecord.source,
    path: dynamoRecord.path,
  };

  await knex('files').insert(updatedRecord);
};

export const migrateFiles = async (
  env: NodeJS.ProcessEnv,
  knex: Knex
): Promise<MigrationSummary> => {
  const filesTable = envUtils.getRequiredEnvVar('FilesTable', env);

  const searchQueue = new DynamoDbSearchQueue({
    TableName: filesTable,
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
      await migrateFileRecord(record, knex);
      migrationSummary.success += 1;
    } catch (error) {
      if (error instanceof RecordAlreadyMigrated) {
        migrationSummary.skipped += 1;
        logger.info(error);
      } else {
        migrationSummary.failed += 1;
        logger.error(
          `Could not create file record in RDS for Dynamo File with bucket: ${record.bucket}, version: ${record.key}}`,
          error
        );
      }
    }

    await searchQueue.shift();
    record = await searchQueue.peek();
  }
  /* eslint-enable no-await-in-loop */
  logger.info(`Successfully migrated ${migrationSummary.success} file records.`);
  return migrationSummary;
};
