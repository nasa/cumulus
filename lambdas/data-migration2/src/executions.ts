import { Knex } from 'knex';
import pMap from 'p-map';
import cloneDeep from 'lodash/cloneDeep';
import { Writable } from 'stream';
import {
  ScanCommandOutput,
} from '@aws-sdk/lib-dynamodb';

import { parallelScan } from '@cumulus/aws-client/DynamoDb';
import { dynamodbDocClient } from '@cumulus/aws-client/services';
import { envUtils } from '@cumulus/common';
import Logger from '@cumulus/logger';
import { ExecutionRecord } from '@cumulus/types/api/executions';
import { ExecutionPgModel, translateApiExecutionToPostgresExecution } from '@cumulus/db';
import { RecordAlreadyMigrated, RecordDoesNotExist } from '@cumulus/errors';
import { ParallelScanMigrationParams, MigrationResult } from '@cumulus/types/migration';

import { closeErrorWriteStreams, createErrorFileWriteStream, storeErrors } from './storeErrors';
import { initialMigrationResult } from './common';

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
    dynamoRecord,
    knex
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

  const [migratedExecution] = await executionPgModel.upsert(knex, updatedRecord);

  return migratedExecution.cumulus_id;
};

const migrateExecutionDynamoRecords = async (
  items: ScanCommandOutput['Items'] = [],
  migrationResult: MigrationResult,
  knex: Knex,
  loggingInterval: number,
  jsonWriteStream: Writable,
  writeConcurrency: number
) => {
  const updatedResult = migrationResult;
  await pMap(
    items,
    async (dynamoRecord) => {
      updatedResult.total_dynamo_db_records += 1;

      if (updatedResult.total_dynamo_db_records % loggingInterval === 0) {
        logger.info(`Batch of ${loggingInterval} execution records processed, ${migrationResult.total_dynamo_db_records} total`);
      }

      try {
        await migrateExecutionRecord(
          <ExecutionRecord>dynamoRecord,
          knex
        );
        updatedResult.migrated += 1;
      } catch (error) {
        if (error instanceof RecordAlreadyMigrated) {
          updatedResult.skipped += 1;
        } else {
          updatedResult.failed += 1;
          const errorMessage = `Could not create execution record in RDS for Dynamo execution arn ${dynamoRecord.arn}:`;
          jsonWriteStream.write(`${errorMessage}, Cause: ${error}\n`);
          logger.error(
            errorMessage,
            error
          );
        }
      }
    },
    {
      stopOnError: false,
      concurrency: writeConcurrency,
    }
  );
};

export const migrateExecutions = async (
  env: NodeJS.ProcessEnv,
  knex: Knex,
  executionMigrationParams: ParallelScanMigrationParams = {},
  testTimestamp?: string
): Promise<MigrationResult> => {
  const executionsTable = envUtils.getRequiredEnvVar('ExecutionsTable', env);
  const bucket = envUtils.getRequiredEnvVar('system_bucket', env);
  const stackName = envUtils.getRequiredEnvVar('stackName', env);

  const loggingInterval = executionMigrationParams.loggingInterval ?? 100;
  const totalSegments = executionMigrationParams.parallelScanSegments ?? 20;
  const writeConcurrency = executionMigrationParams.writeConcurrency ?? 10;

  const migrationResult = cloneDeep(initialMigrationResult);

  const migrationName = 'executions';
  const {
    errorFileWriteStream,
    jsonWriteStream,
    filepath,
  } = createErrorFileWriteStream(migrationName, testTimestamp);

  logger.info(`Starting parallel scan of executions with ${totalSegments} parallel segments`);

  await parallelScan({
    dynamoDbClient: dynamodbDocClient({
      marshallOptions: {
        convertEmptyValues: true,
        removeUndefinedValues: true,
      },
    }),
    totalSegments,
    scanParams: {
      TableName: executionsTable,
      Limit: executionMigrationParams.parallelScanLimit,
    },
    processItemsFunc: (items) => migrateExecutionDynamoRecords(
      items,
      migrationResult,
      knex,
      loggingInterval,
      jsonWriteStream,
      writeConcurrency
    ),
  });
  await closeErrorWriteStreams({ errorFileWriteStream, jsonWriteStream });
  await storeErrors({
    bucket,
    filepath,
    migrationName,
    stackName,
    timestamp: testTimestamp,
  });

  logger.info(`Finished parallel scan of executions with ${totalSegments} parallel segments.`);
  logger.info(`successfully migrated ${migrationResult.migrated} out of ${migrationResult.total_dynamo_db_records} execution records`);
  return migrationResult;
};
