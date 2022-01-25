'use strict';

import Logger from '@cumulus/logger';
import { DataMigration2HandlerEvent } from '@cumulus/types/migration';

import { Context } from 'aws-lambda';

const asyncOperations = require('@cumulus/async-operations');
const { models } = require('@cumulus/api');

const logger = new Logger({ sender: '@cumulus/postgres-migration-async-operation' });

exports.handler = async (event: DataMigration2HandlerEvent, context: Context) => {
  const dynamoTableName = process.env.AsyncOperationsTable;

  logger.info('About to start async operation for Data Migration 2');
  const asyncOperation = await asyncOperations.startAsyncOperation({
    cluster: process.env.EcsCluster,
    callerLambdaName: context.functionName,
    lambdaName: process.env.MigrationLambda,
    asyncOperationTaskDefinition: process.env.AsyncOperationTaskDefinition,
    description: 'Data Migration 2 Lambda ECS Run',
    operationType: 'Data Migration',
    payload: event,
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
    dynamoTableName,
    knexConfig: process.env,
    useLambdaEnvironmentVariables: true,
  }, models.AsyncOperation);

  logger.info(`Started async operation ${asyncOperation.id} for Data Migration 2`);
  return asyncOperation;
};
