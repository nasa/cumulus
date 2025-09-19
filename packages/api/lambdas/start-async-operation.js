'use strict';

const Logger = require('@cumulus/logger');
const asyncOperations = require('@cumulus/async-operations');
const models = require('../models');

const logger = new Logger({ sender: '@cumulus/api/start-async-operation' });

/**
 * Start an async operation
 *
 * @param {Object} event - event object
 * @returns {Promise} an AsyncOperation record
 */
const handler = async (event) => {
  const stackName = process.env.stackName;
  const systemBucket = process.env.system_bucket;
  const cluster = process.env.EcsCluster;
  const asyncOperationTaskDefinition = process.env.AsyncOperationTaskDefinition;

  const {
    asyncOperationId, callerLambdaName, lambdaName, description, operationType, payload,
  } = event;
  console.log('checking operationId: ', asyncOperationId)
  const asyncOperation = await asyncOperations.startAsyncOperation({
    asyncOperationId,
    cluster,
    callerLambdaName,
    lambdaName,
    asyncOperationTaskDefinition,
    description,
    operationType,
    payload,
    stackName,
    systemBucket,
    knexConfig: process.env,
    useLambdaEnvironmentVariables: true,
  }, models.AsyncOperation);

  logger.info(`Started async operation ${asyncOperation.id} for ${operationType}`);
  return asyncOperation;
};

module.exports = { handler };
