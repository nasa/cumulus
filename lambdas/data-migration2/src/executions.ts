import Knex from 'knex';

import { ExecutionRecord } from '@cumulus/types/api/executions';
import { PostgresExecutionRecord, translateApiExecutionToPostgresExecution } from '@cumulus/db';
import { RecordAlreadyMigrated } from './errors';
import { MigrationSummary } from './types';

const Manager = require('@cumulus/api/models/base');
const schemas = require('@cumulus/api/models/schemas');

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
  dynamoRecord: AWS.DynamoDB.DocumentClient.AttributeMap,
  knex: Knex
): Promise<void> => {
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
    <ExecutionRecord>dynamoRecord, <Knex>knex
  );

  if (updatedRecord.parent_cumulus_id !== undefined) {
    // Get parent record
    // Migrate parent record
  }

  await knex('executions').insert(updatedRecord);
};

export const migrateExecutions = async (knex: Knex): Promise<MigrationSummary> => {
  console.log(knex);
  const migrationSummary = {
    dynamoRecords: 0,
    success: 0,
    failed: 0,
    skipped: 0,
  };

  return migrationSummary;
};
