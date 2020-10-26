import Knex from 'knex';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import { envUtils } from '@cumulus/common';
import Logger from '@cumulus/logger';

import { RecordAlreadyMigrated } from './errors';
import { MigrationSummary } from './types';

const Manager = require('@cumulus/api/models/base');
const schemas = require('@cumulus/api/models/schemas');

const logger = new Logger({ sender: '@cumulus/data-migration/async-operations' });

export interface RDSAsyncOperationRecord {
  id: string
  description: string
  operationType: string
  status: string
  output?: Object
  taskArn?: string
  created_at: Date
  updated_at: Date
}

export const migrateAsyncOperationRecord = async (
  dynamoRecord: AWS.DynamoDB.DocumentClient.AttributeMap,
  knex: Knex
): Promise<void> => {
  // Use API model schema to validate record before processing
  Manager.recordIsValid(dynamoRecord, schemas.asyncOperation);

  const updatedRecord: RDSAsyncOperationRecord = {
    id: dynamoRecord.id,
    description: dynamoRecord.description,
    operationType:  dynamoRecord.operationType,
    output: dynamoRecord.output,
    status: dynamoRecord.status,
    taskArn:  dynamoRecord.taskArn,
    created_at: new Date(dynamoRecord.createdAt),
    updated_at: new Date(dynamoRecord.updatedAt),
  }

  await knex('asyncOperations').insert(updatedRecord);
}

export const migrateAsyncOperations = async (
  env: NodeJS.ProcessEnv,
  knex: Knex
): Promise<MigrationSummary> => {
  const asyncOperationsTable = envUtils.getRequiredEnvVar('AsyncOperationsTable', env);

  const searchQueue = new DynamoDbSearchQueue({
    TableName: asyncOperationsTable
  });

  const migrationSummary = {
    dynamoRecords: 0,
    success: 0,
    failed: 0,
    skipped: 0,
  }

  let record = await searchQueue.peek();
  /* eslint-disable no-await-in-loop */
  while(record) {
    migrationSummary.dynamoRecords += 1;

    try {
      await migrateAsyncOperationRecord(record, knex);
      migrationSummary.success += 1;
    } catch (error) {
      if (error instanceof RecordAlreadyMigrated) {
        migrationSummary.skipped += 1;
        logger.info(error);
      } else {
        migrationSummary.failed += 1;
        logger.error(
          `Could not create collection record in RDS for Dynamo collection name ${record.name}, version ${record.version}:`,
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
