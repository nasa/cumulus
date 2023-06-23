'use strict';

const Logger = require('@cumulus/logger');
const router = require('express-promise-router')();
const asyncOperations = require('@cumulus/async-operations');
const { getQueueUrlByName } = require('@cumulus/aws-client/SQS');

const { asyncOperationEndpointErrorHandler } = require('../app/middleware');

const { getFunctionNameFromRequestContext } = require('../lib/request');

const logger = new Logger({ sender: '@cumulus/api/replays' });
/**
 * Start an AsyncOperation that will perform kinesis message replay
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function startKinesisReplayAsyncOperation(req, res) {
  const stackName = process.env.stackName;
  const systemBucket = process.env.system_bucket;

  const payload = req.body;

  if (!payload.type) {
    return res.boom.badRequest('replay type is required');
  }

  if (payload.type === 'kinesis' && !payload.kinesisStream) {
    return res.boom.badRequest('kinesisStream is required for kinesis-type replay');
  }
  const asyncOperation = await asyncOperations.startAsyncOperation({
    asyncOperationTaskDefinition: process.env.AsyncOperationTaskDefinition,
    cluster: process.env.EcsCluster,
    description: 'Kinesis Replay',
    knexConfig: process.env,
    callerLambdaName: getFunctionNameFromRequestContext(req),
    lambdaName: process.env.ManualConsumerLambda,
    operationType: 'Kinesis Replay',
    payload,
    stackName,
    systemBucket,
    useLambdaEnvironmentVariables: true,
  });
  return res.status(202).send({ asyncOperationId: asyncOperation.id });
}

async function startSqsMessagesReplay(req, res) {
  const stackName = process.env.stackName;
  const systemBucket = process.env.system_bucket;

  const payload = req.body;
  logger.debug(`Payload is ${JSON.stringify(payload)}`);

  if (!payload.queueName) {
    return res.boom.badRequest('queueName is required for SQS messages replay');
  }

  try {
    await getQueueUrlByName(payload.queueName);
  } catch (error) {
    return res.boom.badRequest(`Could not retrieve queue URL for ${payload.queueName}. Unable to process message. Error ${error}`);
  }

  const asyncOperation = await asyncOperations.startAsyncOperation({
    asyncOperationTaskDefinition: process.env.AsyncOperationTaskDefinition,
    cluster: process.env.EcsCluster,
    description: 'SQS Replay',
    knexConfig: process.env,
    callerLambdaName: getFunctionNameFromRequestContext(req),
    lambdaName: process.env.ReplaySqsMessagesLambda,
    operationType: 'SQS Replay',
    payload,
    stackName,
    systemBucket,
    useLambdaEnvironmentVariables: true,
  });
  return res.status(202).send({ asyncOperationId: asyncOperation.id });
}

router.post('/', startKinesisReplayAsyncOperation, asyncOperationEndpointErrorHandler);
router.post('/sqs', startSqsMessagesReplay, asyncOperationEndpointErrorHandler);

module.exports = {
  startKinesisReplayAsyncOperation,
  startSqsMessagesReplay,
  router,
};
