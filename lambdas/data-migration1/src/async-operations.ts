import Knex from 'knex';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import { envUtils } from '@cumulus/common';
import {
  AsyncOperationPgModel,
  translateApiAsyncOperationToPostgresAsyncOperation,
} from '@cumulus/db';
import { ApiAsyncOperation } from '@cumulus/types/api/async_operations';
import Logger from '@cumulus/logger';
import { RecordAlreadyMigrated, RecordDoesNotExist } from '@cumulus/errors';

import { MigrationSummary } from './types';

const logger = new Logger({ sender: '@cumulus/data-migration/async-operations' });

export const migrateAsyncOperationRecord = async (
  dynamoRecord: AWS.DynamoDB.DocumentClient.AttributeMap,
  knex: Knex
): Promise<void> => {
  const asyncOperationPgModel = new AsyncOperationPgModel();

  let existingRecord;

  try {
    existingRecord = await asyncOperationPgModel.get(knex, { id: dynamoRecord.id });
  } catch (error) {
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
  }

  if (existingRecord && existingRecord.updated_at >= new Date(dynamoRecord.updatedAt)) {
    throw new RecordAlreadyMigrated(`Async Operation ${dynamoRecord.id} was already migrated, skipping`);
  }

  const updatedRecord = translateApiAsyncOperationToPostgresAsyncOperation(
    <ApiAsyncOperation>dynamoRecord
  );

  await asyncOperationPgModel.upsert(knex, updatedRecord);
};

export const migrateAsyncOperations = async (
  env: NodeJS.ProcessEnv,
  knex: Knex
): Promise<MigrationSummary> => {
  const asyncOperationsTable = envUtils.getRequiredEnvVar('AsyncOperationsTable', env);

  const searchQueue = new DynamoDbSearchQueue({
    TableName: asyncOperationsTable,
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
      await migrateAsyncOperationRecord(record, knex);
      migrationSummary.success += 1;
    } catch (error) {
      if (error instanceof RecordAlreadyMigrated) {
        migrationSummary.skipped += 1;
      } else {
        migrationSummary.failed += 1;
        logger.error(
          `Could not create async-operation record in RDS for Dynamo async-operation id ${record.id}:`,
          error
        );
      }
    }

    await searchQueue.shift();
    record = await searchQueue.peek();
  }
  /* eslint-enable no-await-in-loop */
  logger.info(`successfully migrated ${migrationSummary.success} async operation records`);
  return migrationSummary;
};
