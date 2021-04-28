import Knex from 'knex';
import Logger from '@cumulus/logger';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import { envUtils } from '@cumulus/common';
import { ExecutionRecord } from '@cumulus/types/api/executions';
import { ExecutionPgModel, translateApiExecutionToPostgresExecution } from '@cumulus/db';
import { RecordAlreadyMigrated, RecordDoesNotExist } from '@cumulus/errors';
import { MigrationResult } from '@cumulus/types/migration';
import { closeErrorWriteStreams, createErrorFileWriteStream, storeErrors } from './storeErrors';

const Execution = require('@cumulus/api/models/executions');

const logger = new Logger({ sender: '@cumulus/data-migration/executions' });

/**
 * Migrate execution record from Dynamo to RDS.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} dynamoRecord
 *   - Source record from DynamoDB
 * @param {Knex} knex
 *   - Knex client for writing to RDS database
 * @returns {Promise<number>}
 *   - Cumulus ID for record
 * @throws {RecordAlreadyMigrated}
 *   - If record was already migrated
 */
export const migrateExecutionRecord = async (
  dynamoRecord: ExecutionRecord,
  knex: Knex
): Promise<number> => {
  const executionPgModel = new ExecutionPgModel();

  let existingRecord;

  try {
    existingRecord = await executionPgModel.get(knex, {
      arn: dynamoRecord.arn,
    });
  } catch (error) {
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
  }
  if (existingRecord && existingRecord.updated_at >= new Date(dynamoRecord.updatedAt)) {
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

  const [cumulusId] = await executionPgModel.upsert(knex, updatedRecord);

  return cumulusId;
};

/**
 * Migrate executions
 * @param {NodeJS.ProcessEnv} env
 * @param {Knex} knex
 * @param {string | undefined} testTimestamp - Timestamp to use for unit testing
 */
export const migrateExecutions = async (
  env: NodeJS.ProcessEnv,
  knex: Knex,
  testTimestamp?: string
): Promise<MigrationResult> => {
  const executionsTable = envUtils.getRequiredEnvVar('ExecutionsTable', env);
  const bucket = envUtils.getRequiredEnvVar('system_bucket', env);
  const stackName = envUtils.getRequiredEnvVar('stackName', env);
  const loggingInterval = env.loggingInterval ? Number.parseInt(env.loggingInterval, 10) : 100;

  const searchQueue = new DynamoDbSearchQueue({
    TableName: executionsTable,
  });

  const migrationResult = {
    total_dynamo_db_records: 0,
    migrated: 0,
    failed: 0,
    skipped: 0,
  };

  const migrationName = 'executions';
  const {
    errorFileWriteStream,
    jsonWriteStream,
    filepath,
  } = createErrorFileWriteStream(migrationName);

  let record = await searchQueue.peek();
  /* eslint-disable no-await-in-loop */
  while (record) {
    migrationResult.total_dynamo_db_records += 1;

    if (migrationResult.total_dynamo_db_records % loggingInterval === 0) {
      logger.info(`Batch of ${loggingInterval} execution records processed, ${migrationResult.total_dynamo_db_records} total`);
    }

    try {
      await migrateExecutionRecord(<ExecutionRecord>record, knex);
      migrationResult.migrated += 1;
    } catch (error) {
      if (error instanceof RecordAlreadyMigrated) {
        migrationResult.skipped += 1;
      } else {
        migrationResult.failed += 1;
        const errorMessage = `Could not create execution record in RDS for Dynamo execution arn ${record.arn}:`;
        jsonWriteStream.write(`${errorMessage}, Cause: ${error}\n`);
        logger.error(errorMessage, error);
      }
    }

    await searchQueue.shift();
    record = await searchQueue.peek();
  }
  await closeErrorWriteStreams({ errorFileWriteStream, jsonWriteStream });
  await storeErrors({
    bucket,
    filepath,
    migrationName,
    stackName,
    timestamp: testTimestamp,
  });
  /* eslint-enable no-await-in-loop */
  logger.info(`successfully migrated ${migrationResult.migrated} execution records`);
  return migrationResult;
};
