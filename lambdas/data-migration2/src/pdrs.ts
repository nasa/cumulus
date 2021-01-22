import Knex from 'knex';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import Logger from '@cumulus/logger';
import {
  getRecordCumulusId,
  CollectionPgModel,
  PdrPgModel,
  PostgresExecutionRecord,
  PostgresPdr,
  ProviderPgModel,
  tableNames,
} from '@cumulus/db';
import { envUtils } from '@cumulus/common';
import { RecordAlreadyMigrated } from '@cumulus/errors';

import { MigrationSummary } from './types';

const logger = new Logger({ sender: '@cumulus/data-migration/pdrs' });
const Manager = require('@cumulus/api/models/base');
const schemas = require('@cumulus/api/models/schemas');

/**
 * Migrate PDR record from Dynamo to RDS.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} dynamoRecord
 *   Record from DynamoDB
 * @param {Knex} knex - Knex client for writing to RDS database
 * @returns {Promise<number>} - Cumulus ID for record
 * @throws {RecordAlreadyMigrated} if record was already migrated
 */
export const migratePdrRecord = async (
  dynamoRecord: AWS.DynamoDB.DocumentClient.AttributeMap,
  knex: Knex
): Promise<void> => {
  // Validate record before processing using API model schema
  Manager.recordIsValid(dynamoRecord, schemas.pdr);
  const [name, version] = dynamoRecord.collectionId.split('___');
  const collectionPgModel = new CollectionPgModel();
  const pdrPgModel = new PdrPgModel();
  const providerPgModel = new ProviderPgModel();

  const existingRecord = await pdrPgModel.get(knex, { name: dynamoRecord.pdrName });

  // Throw error if it was already migrated.
  if (existingRecord) {
    throw new RecordAlreadyMigrated(`PDR name ${dynamoRecord.pdrName} was already migrated, skipping.`);
  }
  const collectionCumulusId = await collectionPgModel.getRecordCumulusId(
    knex,
    { name, version }
  );

  const providerCumulusId = await providerPgModel.getRecordCumulusId(
    knex,
    { name: dynamoRecord.provider }
  );

  const executionCumulusId = dynamoRecord.execution
    ? await getRecordCumulusId<PostgresExecutionRecord>(
      { arn: dynamoRecord.execution },
      tableNames.executions,
      knex
    )
    : undefined;

  // Map old record to new schema.
  const updatedRecord: PostgresPdr = {
    name: dynamoRecord.pdrName,
    provider_cumulus_id: providerCumulusId,
    collection_cumulus_id: collectionCumulusId,
    execution_cumulus_id: executionCumulusId,
    status: dynamoRecord.status,
    progress: dynamoRecord.progress,
    pan_sent: dynamoRecord.PANSent,
    pan_message: dynamoRecord.PANmessage,
    stats: dynamoRecord.stats,
    address: dynamoRecord.address,
    original_url: dynamoRecord.originalUrl,
    timestamp: dynamoRecord.timestamp ? new Date(dynamoRecord.timestamp) : undefined,
    duration: dynamoRecord.duration,
    created_at: new Date(dynamoRecord.createdAt),
    updated_at: dynamoRecord.updatedAt ? new Date(dynamoRecord.updatedAt) : undefined,
  };

  await pdrPgModel.upsert(knex, updatedRecord);
};

export const migratePdrs = async (
  env: NodeJS.ProcessEnv,
  knex: Knex
): Promise<MigrationSummary> => {
  const pdrsTable = envUtils.getRequiredEnvVar('PdrsTable', env);

  const searchQueue = new DynamoDbSearchQueue({
    TableName: pdrsTable,
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
      await migratePdrRecord(record, knex);
      migrationSummary.success += 1;
    } catch (error) {
      if (error instanceof RecordAlreadyMigrated) {
        migrationSummary.skipped += 1;
        logger.info(error);
      } else {
        migrationSummary.failed += 1;
        logger.error(
          `Could not create PDR record in RDS for Dynamo PDR name: ${record.pdrName}`,
          error
        );
      }
    }

    await searchQueue.shift();
    record = await searchQueue.peek();
  }
  /* eslint-enable no-await-in-loop */
  logger.info(`Successfully migrated ${migrationSummary.success} PDR records.`);
  return migrationSummary;
};
