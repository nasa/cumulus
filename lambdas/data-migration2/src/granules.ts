import Knex from 'knex';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import {
  PostgresCollectionRecord,
  PostgresProviderRecord,
  PostgresExecutionRecord,
  PostgresPdrRecord,
  PostgresGranuleRecord,
  PostgresGranule,
  getRecordCumulusId,
  tableNames,
} from '@cumulus/db';
import { envUtils } from '@cumulus/common';
import Logger from '@cumulus/logger';

import { RecordAlreadyMigrated } from './errors';
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
  // Validate record before processing using API model schema
  Manager.recordIsValid(dynamoRecord, schemas.granule);

  const collectionCumulusId = await getRecordCumulusId<PostgresCollectionRecord>(
    { name: dynamoRecord.collectionId },
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
    pdr_cumulus_id: pdrCumulusId,
    collection_cumulus_id: collectionCumulusId,
    status: dynamoRecord.status,
    execution_cumulus_id: executionCumulusId,
    cmr_link: dynamoRecord.cmrLink,
    published: dynamoRecord.published,
    duration: dynamoRecord.duration,
    error: dynamoRecord.error,
    product_volume: dynamoRecord.productVolume,
    time_to_process: dynamoRecord.timeToPreprocess,
    time_to_archive: dynamoRecord.timeToArchive,
    provider_cumulus_id: providerCumulusId,
    created_at: new Date(dynamoRecord.createdAt),
    updated_at: new Date(dynamoRecord.updatedAt),
    timestamp: new Date(dynamoRecord.timestamp),
    beginning_date_time: new Date(dynamoRecord.beginningDateTime),
    ending_date_time: new Date(dynamoRecord.endingDateTime),
    production_date_time: new Date(dynamoRecord.productionDateTime),
    last_update_date_time: new Date(dynamoRecord.lastUpdateDateTime),
    processing_start_date_time: new Date(dynamoRecord.processingStartDateTime),
    processing_end_date_time: new Date(dynamoRecord.processingEndDateTime),
  };

  await knex('granules').insert(updatedRecord);
};

export const migrateGranules = async (
  env: NodeJS.ProcessEnv,
  knex: Knex
): Promise<MigrationSummary> => {
  const granulesTable = envUtils.getRequiredEnvVar('GranulesTable', env);

  const searchQueue = new DynamoDbSearchQueue({
    TableName: granulesTable,
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
      await migrateGranuleRecord(record, knex);
      migrationSummary.success += 1;
    } catch (error) {
      if (error instanceof RecordAlreadyMigrated) {
        migrationSummary.skipped += 1;
        logger.info(error);
      } else {
        migrationSummary.failed += 1;
        logger.error(
          `Could not create granule record in RDS for Dynamo Granule name: ${record.name}, version: ${record.version}}`,
          error
        );
      }
    }

    await searchQueue.shift();
    record = await searchQueue.peek();
  }
  /* eslint-enable no-await-in-loop */
  logger.info(`Successfully migrated ${migrationSummary.success} granule records.`);
  return migrationSummary;
};
