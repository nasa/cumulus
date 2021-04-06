'use strict';

const asyncOperations = require('@cumulus/async-operations');
const Logger = require('@cumulus/logger');
const { models } = require('@cumulus/api');

const logger = new Logger({ sender: '@cumulus/postgres-migration-async-operation' });
exports.handler = async () => {
  const stackName = process.env.stackName;
  const systemBucket = process.env.system_bucket;
  const dynamoTableName = process.env.AsyncOperationsTable;

  logger.info('Starting Postgres Migration Async Operation');
  const asyncOperation = await asyncOperations.startAsyncOperation({
    cluster: process.env.EcsCluster,
    lambdaName: process.env.MigrationLambda,
    asyncOperationTaskDefinition: process.env.AsyncOperationTaskDefinition,
    description: 'Data Migration 2 Lambda ECS Run',
    operationType: 'Data Migration',
    payload: {},
    stackName,
    systemBucket,
    dynamoTableName: dynamoTableName,
    knexConfig: process.env,
    useLambdaEnvironmentVariables: true,
  }, models.AsyncOperation);

  logger.info('Completed Postgres Migration Async Operation');
  return asyncOperation;
};
