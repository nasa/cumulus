import Knex from 'knex';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import { ApiFile } from '@cumulus/types/api/files';
import {
  CollectionPgModel,
  GranulePgModel,
  FilePgModel,
  PostgresFile,
  PostgresGranuleRecord,
  translateApiGranuleToPostgresGranule,
} from '@cumulus/db';
import { envUtils } from '@cumulus/common';
import Logger from '@cumulus/logger';

import { RecordAlreadyMigrated } from '@cumulus/errors';
import { MigrationSummary } from './types';

const logger = new Logger({ sender: '@cumulus/data-migration/granules' });
const Manager = require('@cumulus/api/models/base');
const schemas = require('@cumulus/api/models/schemas');
const { getBucket, getKey } = require('@cumulus/api/lib/FileUtils');
const { deconstructCollectionId } = require('@cumulus/api/lib/utils');

export interface GranulesAndFilesMigrationSummary {
  granulesSummary: MigrationSummary,
  filesSummary: MigrationSummary,
}

/**
 * Migrate granules record from Dynamo to RDS.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} record
 *   Record from DynamoDB
 * @param {Knex} knex - Knex client for writing to RDS database
 * @returns {Promise<void>}
 * @throws {RecordAlreadyMigrated} if record was already migrated
 */
export const migrateGranuleRecord = async (
  record: AWS.DynamoDB.DocumentClient.AttributeMap,
  knex: Knex
): Promise<void> => {
  // Validate record before processing using API model schema
  Manager.recordIsValid(record, schemas.granule);
  const { name, version } = deconstructCollectionId(record.collectionId);
  const collectionPgModel = new CollectionPgModel();
  const granulePgModel = new GranulePgModel();

  const collectionCumulusId = await collectionPgModel.getRecordCumulusId(
    knex,
    { name, version }
  );

  const existingRecord = await knex<PostgresGranuleRecord>('granules')
    .where({ granule_id: record.granuleId, collection_cumulus_id: collectionCumulusId })
    .first();

  // Throw error if it was already migrated.
  if (existingRecord) {
    throw new RecordAlreadyMigrated(`Granule ${record.granuleId} was already migrated, skipping`);
  }

  const granule = await translateApiGranuleToPostgresGranule(record, knex, collectionPgModel);
  await granulePgModel.upsert(knex, granule);
};

/**
 * Migrate File record from a Granules record from DynamoDB  to RDS.
 *
 * @param {ApiFile} file - Granule file
 * @param {string} granuleId - ID of granule
 * @param {string} collectionId - ID of collection
 * @param {Knex} knex - Knex client for writing to RDS database
 * @returns {Promise<number>} - Cumulus ID for record
 * @throws {RecordAlreadyMigrated} if record was already migrated
 */
export const migrateFileRecord = async (
  file: ApiFile,
  granuleId: string,
  collectionId: string,
  knex: Knex
): Promise<void> => {
  const { name, version } = deconstructCollectionId(collectionId);
  const collectionPgModel = new CollectionPgModel();
  const granulePgModel = new GranulePgModel();
  const filePgModel = new FilePgModel();

  const collectionCumulusId = await collectionPgModel.getRecordCumulusId(
    knex,
    { name, version }
  );

  const granuleCumulusId = await granulePgModel.getRecordCumulusId(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );

  const bucket = getBucket(file);
  const key = getKey(file);

  // Map old record to new schema.
  const updatedRecord: PostgresFile = {
    bucket,
    key,
    granule_cumulus_id: granuleCumulusId,
    file_size: file.size,
    checksum_value: file.checksum,
    checksum_type: file.checksumType,
    file_name: file.fileName,
    source: file.source,
    path: file.path,
  };
  await filePgModel.upsert(knex, updatedRecord);
};

/**
 * Migrate granule and files from DynamoDB to RDS
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} dynamoRecord
 * @param {Knex} knex
 * @param {GranulesAndFilesMigrationSummary} granuleAndFileMigrationSummary
 * @returns {Promise<MigrationSummary>} - Migration summary for files
 */
export const migrateGranuleAndFilesViaTransaction = async (
  dynamoRecord: AWS.DynamoDB.DocumentClient.AttributeMap,
  knex: Knex,
  granuleAndFileMigrationSummary: GranulesAndFilesMigrationSummary
): Promise<GranulesAndFilesMigrationSummary> => {
  const files = dynamoRecord.files;
  const granuleId = dynamoRecord.granuleId;
  const collectionId = dynamoRecord.collectionId;
  const { granulesSummary, filesSummary } = granuleAndFileMigrationSummary;

  try {
    granulesSummary.dynamoRecords += 1;
    await migrateGranuleRecord(dynamoRecord, knex);
    granulesSummary.success += 1;
    await Promise.all(files.map(async (file : ApiFile) => {
      filesSummary.dynamoRecords += 1;
      try {
        await migrateFileRecord(file, granuleId, collectionId, knex);
        filesSummary.success += 1;
      } catch (error) {
        filesSummary.failed += 1;
        logger.error(
          `Could not create file record in RDS for file ${file}`,
          error
        );
      }
    }));
  } catch (error) {
    if (error instanceof RecordAlreadyMigrated) {
      granulesSummary.skipped += 1;
      logger.info(error);
    } else {
      granulesSummary.failed += 1;
      logger.error(
        `Could not create granule record and file records in RDS for DynamoDB Granule granuleId: ${dynamoRecord.granuleId} with files ${dynamoRecord.files}`,
        error
      );
    }
  }

  return { granulesSummary, filesSummary };
};

export const migrateGranulesAndFiles = async (
  env: NodeJS.ProcessEnv,
  knex: Knex
): Promise<GranulesAndFilesMigrationSummary> => {
  const granulesTable = envUtils.getRequiredEnvVar('GranulesTable', env);

  const searchQueue = new DynamoDbSearchQueue({
    TableName: granulesTable,
  });

  const granuleMigrationSummary = {
    dynamoRecords: 0,
    success: 0,
    failed: 0,
    skipped: 0,
  };

  const fileMigrationSummary = {
    dynamoRecords: 0,
    success: 0,
    failed: 0,
    skipped: 0,
  };

  const summary = {
    granulesSummary: granuleMigrationSummary,
    filesSummary: fileMigrationSummary,
  };

  let record = await searchQueue.peek();

  /* eslint-disable no-await-in-loop */
  while (record) {
    const migrationSummary = await migrateGranuleAndFilesViaTransaction(record, knex, summary);
    summary.granulesSummary = migrationSummary.granulesSummary;
    summary.filesSummary = migrationSummary.filesSummary;

    await searchQueue.shift();
    record = await searchQueue.peek();
  }
  /* eslint-enable no-await-in-loop */
  logger.info(`Successfully migrated ${summary.granulesSummary.success} granule records.`);
  logger.info(`Successfully migrated ${summary.filesSummary.success} file records.`);
  return { granulesSummary: summary.granulesSummary, filesSummary: summary.filesSummary };
};
