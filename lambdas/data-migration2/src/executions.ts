import Knex from 'knex';
import pMap from 'p-map';

import { parallelScan } from '@cumulus/aws-client/DynamoDb';
import { envUtils } from '@cumulus/common';
import Logger from '@cumulus/logger';
import { ExecutionRecord } from '@cumulus/types/api/executions';
import { ExecutionPgModel, translateApiExecutionToPostgresExecution } from '@cumulus/db';
import { RecordAlreadyMigrated, RecordDoesNotExist } from '@cumulus/errors';
import { ParallelScanMigrationParams, MigrationResult } from '@cumulus/types/migration';

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

  const [cumulusId] = await executionPgModel.upsert(knex, updatedRecord);

  return cumulusId;
};

const processExecutionItems = async (
  items: AWS.DynamoDB.DocumentClient.AttributeMap[],
  migrationResult: MigrationResult,
  knex: Knex,
  loggingInterval: number,
  writeConcurrency?: number
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
          logger.error(
            `Could not create execution record in RDS for DynamoDB execution arn: ${dynamoRecord.arn}}`,
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
  executionMigrationParams: ParallelScanMigrationParams = {}
): Promise<MigrationResult> => {
  const executionsTable = envUtils.getRequiredEnvVar('ExecutionsTable', env);
  const loggingInterval = executionMigrationParams.loggingInterval ?? 100;

  const migrationResult = {
    total_dynamo_db_records: 0,
    migrated: 0,
    failed: 0,
    skipped: 0,
  };

  const totalSegments = executionMigrationParams.parallelScanSegments ?? 20;

  logger.info(`Starting parallel scan of executions with ${totalSegments} parallel segments`);

  await parallelScan({
    totalSegments,
    scanParams: {
      TableName: executionsTable,
      Limit: executionMigrationParams.parallelScanLimit,
    },
    processItemsFunc: (items) => processExecutionItems(
      items,
      migrationResult,
      knex,
      loggingInterval,
      executionMigrationParams.writeConcurrency
    ),
  });

  logger.info(`Finished parallel scan of executions with ${totalSegments} parallel segments.`);
  logger.info(`successfully migrated ${migrationResult.migrated} out of ${migrationResult.total_dynamo_db_records} execution records`);
  return migrationResult;
};
