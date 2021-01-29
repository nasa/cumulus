import Knex from 'knex';
import Logger from '@cumulus/logger';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import { envUtils } from '@cumulus/common';
import { ExecutionRecord } from '@cumulus/types/api/executions';
import { PostgresExecutionRecord, translateApiExecutionToPostgresExecution } from '@cumulus/db';
import { RecordAlreadyMigrated } from '@cumulus/errors';
import { MigrationSummary } from './types';

const Manager = require('@cumulus/api/models/base');
const schemas = require('@cumulus/api/models/schemas');
const Execution = require('@cumulus/api/models/executions');

const logger = new Logger({ sender: '@cumulus/data-migration/executions' });

/**
 * Migrate execution record from Dynamo to RDS.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} dynamoRecord
 *   Source record from DynamoDB
 * @param {Knex} knex - Knex client for writing to RDS database
 * @returns {Promise<number>} - Cumulus ID for record
 * @throws {RecordAlreadyMigrated}
 *   if record was already migrated
 */
export const migrateExecutionRecord = async (
  dynamoRecord: ExecutionRecord,
  knex: Knex
): Promise<number> => {
  // Use API model schema to validate record before processing
  Manager.recordIsValid(dynamoRecord, schemas.execution);

  const existingRecord = await knex<PostgresExecutionRecord>('executions')
    .where({
      arn: dynamoRecord.arn,
    })
    .first();
  // Throw error if it was already migrated.
  if (existingRecord) {
    throw new RecordAlreadyMigrated(`Execution arn ${dynamoRecord.arn} was already migrated, skipping`);
  }

  const updatedRecord = await translateApiExecutionToPostgresExecution(
    dynamoRecord, knex
  );

  // If we have a parent ARN from the dynamo record but we couldn't find a cumulus_id in Postgres,
  // we need to migrate the parent dynamo record to Postgres
  if (dynamoRecord.parentArn !== undefined && updatedRecord.parent_cumulus_id === undefined) {
    // Get parent record from Dynamo
    const executionModel = new Execution();
    const parentExecution = await executionModel.get({ arn: dynamoRecord.parentArn });

    // Migrate parent dynamo record to Postgres and assign parent's cumulus_id to child
    updatedRecord.parent_cumulus_id = await migrateExecutionRecord(parentExecution, knex);
  }

  const [cumulusId] = await knex('executions').insert(updatedRecord).returning('cumulus_id');

  return cumulusId;
};

export const migrateExecutions = async (
  env: NodeJS.ProcessEnv,
  knex: Knex
): Promise<MigrationSummary> => {
  const executionsTable = envUtils.getRequiredEnvVar('ExecutionsTable', env);

  const searchQueue = new DynamoDbSearchQueue({
    TableName: executionsTable,
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
      await migrateExecutionRecord(<ExecutionRecord>record, knex);
      migrationSummary.success += 1;
    } catch (error) {
      if (error instanceof RecordAlreadyMigrated) {
        migrationSummary.skipped += 1;
        logger.info(error);
      } else {
        migrationSummary.failed += 1;
        logger.error(
          `Could not create execution record in RDS for Dynamo execution arn ${record.arn}:`,
          error
        );
      }
    }

    await searchQueue.shift();
    record = await searchQueue.peek();
  }
  /* eslint-enable no-await-in-loop */
  logger.info(`successfully migrated ${migrationSummary.success} execution records`);
  return migrationSummary;
};
