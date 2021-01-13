import Knex from 'knex';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import {
  PostgresCollectionRecord,
  PostgresProviderRecord,
  PostgresExecutionRecord,
  PostgresPdrRecord,
  PostgresGranuleRecord,
  PostgresGranule,
  PostgresFileRecord,
  PostgresFile,
  getRecordCumulusId,
  tableNames,
} from '@cumulus/db';
import { envUtils } from '@cumulus/common';
import Logger from '@cumulus/logger';

import { RecordAlreadyMigrated } from '@cumulus/errors';
import { MigrationSummary } from './types';

const logger = new Logger({ sender: '@cumulus/data-migration/granules' });
const Manager = require('@cumulus/api/models/base');
const schemas = require('@cumulus/api/models/schemas');

/**
 * Migrate granules record from Dynamo to RDS.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} dynamoRecord
 *   Record from DynamoDB
 * @param {Knex} knex - Knex client for writing to RDS database
 * @returns {Promise<number>} - Cumulus ID for record
 * @throws {RecordAlreadyMigrated} if record was already migrated
 */
export const migrateGranuleRecord = async (
  dynamoRecord: AWS.DynamoDB.DocumentClient.AttributeMap,
  knex: Knex
): Promise<void> => {
  const [name, version] = dynamoRecord.collectionId.split('___');

  const collectionCumulusId = await getRecordCumulusId<PostgresCollectionRecord>(
    { name, version },
    tableNames.collections,
    knex
  );

  const providerCumulusId = dynamoRecord.provider
    ? await getRecordCumulusId<PostgresProviderRecord>(
      { name: dynamoRecord.provider },
      tableNames.providers,
      knex
    )
    : undefined;
  const pdrCumulusId = dynamoRecord.pdrName
    ? await getRecordCumulusId<PostgresPdrRecord>(
      { name: dynamoRecord.pdrName },
      tableNames.pdrs,
      knex
    )
    : undefined;

  const executionCumulusId = dynamoRecord.execution
    ? await getRecordCumulusId<PostgresExecutionRecord>(
      { arn: dynamoRecord.execution },
      tableNames.executions,
      knex
    )
    : undefined;

  const existingRecord = await knex<PostgresGranuleRecord>('granules')
    .where({ granule_id: dynamoRecord.granuleId, collection_cumulus_id: collectionCumulusId })
    .first();

  // Throw error if it was already migrated.
  if (existingRecord) {
    throw new RecordAlreadyMigrated(`Granule name ${dynamoRecord.name} was already migrated, skipping`);
  }

  // Map old record to new schema.
  const updatedRecord: PostgresGranule = {
    granule_id: dynamoRecord.granuleId,
    status: dynamoRecord.status,
    collection_cumulus_id: collectionCumulusId,
    published: dynamoRecord.published,
    duration: dynamoRecord.duration,
    time_to_archive: dynamoRecord.timeToArchive,
    time_to_process: dynamoRecord.timeToPreprocess,
    product_volume: dynamoRecord.productVolume,
    error: dynamoRecord.error,
    cmr_link: dynamoRecord.cmrLink,
    execution_cumulus_id: executionCumulusId,
    pdr_cumulus_id: pdrCumulusId,
    provider_cumulus_id: providerCumulusId,
    beginning_date_time: new Date(dynamoRecord.beginningDateTime),
    ending_date_time: new Date(dynamoRecord.endingDateTime),
    last_update_date_time: new Date(dynamoRecord.lastUpdateDateTime),
    processing_end_date_time: new Date(dynamoRecord.processingEndDateTime),
    processing_start_date_time: new Date(dynamoRecord.processingStartDateTime),
    production_date_time: new Date(dynamoRecord.productionDateTime),
    timestamp: new Date(dynamoRecord.timestamp),
    created_at: new Date(dynamoRecord.createdAt),
    updated_at: new Date(dynamoRecord.updatedAt),
  };

  await knex('granules').insert(updatedRecord);
};

/**
 * Migrate Files record from a Granules record from DynamoDB  to RDS.
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

export const migrateGranulesAndFiles = async (
  env: NodeJS.ProcessEnv,
  knex: Knex
): Promise<MigrationSummary> => {
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
  let record = await searchQueue.peek();

  /* eslint-disable no-await-in-loop */
  while (record) {
    granuleMigrationSummary.dynamoRecords += 1;
    // Validate record before processing using API model schema
    Manager.recordIsValid(record, schemas.granule);
    const files = record.files;

    try {
      await migrateGranuleRecord(record, knex);
      granuleMigrationSummary.success += 1;
    } catch (error) {
      if (error instanceof RecordAlreadyMigrated) {
        granuleMigrationSummary.skipped += 1;
        logger.info(error);
      } else {
        granuleMigrationSummary.failed += 1;
        logger.error(
          `Could not create granule record in RDS for Dynamo Granule granuleId: ${record.granuleId}`,
          error
        );
      }

      while (files) {
        files.map(async (file : any) => {
          try {
            await migrateFileRecord(file, knex);
            fileMigrationSummary.success += 1;
          } catch (migrationError) {
            if (migrationError instanceof RecordAlreadyMigrated) {
              fileMigrationSummary.skipped += 1;
              logger.info(migrationError);
            } else {
              fileMigrationSummary.failed += 1;
              logger.error(
                `Could not create file record in RDS for Dynamo File bucket: ${file.bucket}, key: ${file.key}`,
                error
              );
            }
          }
        });
      }
    }

    await searchQueue.shift();
    record = await searchQueue.peek();
  }
  /* eslint-enable no-await-in-loop */
  logger.info(`Successfully migrated ${granuleMigrationSummary.success} granule records.`);
  logger.info(`Successfully migrated ${fileMigrationSummary.success} file records.`);
  return granuleMigrationSummary;
};
