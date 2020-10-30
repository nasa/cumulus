'use strict';

const Logger = require('@cumulus/logger');
const router = require('express-promise-router')();
const asyncOperations = require('@cumulus/async-operations');
const { localStackConnectionEnv } = require('@cumulus/db');

const coreLogger = new Logger();

const { asyncOperationEndpointErrorHandler } = require('../app/middleware');
const AsyncOperation = require('../models/async-operation');
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

  const asyncOperationModel = new AsyncOperation({ stackName, systemBucket });

  const payload = req.body;

  if (!payload.type) {
    return res.boom.badRequest('replay type is required');
  }

  if (payload.type === 'kinesis' && !payload.kinesisStream) {
    return res.boom.badRequest('kinesisStream is required for kinesis-type replay');
  }

  const knexConfig = { ...localStackConnectionEnv, ...process.env };

  coreLogger.info(JSON.stringify({ ...localStackConnectionEnv, ...process.env }));

  const asyncOperation = await asyncOperations.startAsyncOperation({
    asyncOperationTaskDefinition: process.env.AsyncOperationTaskDefinition,
    cluster: process.env.EcsCluster,
    description: 'Kinesis Replay',
    dynamoTableName: asyncOperationModel.tableName,
    knexConfig,
    lambdaName: process.env.ManualConsumerLambda,
    operationType: 'Kinesis Replay',
    payload,
    stackName,
    systemBucket,
    useLambdaEnvironmentVariables: true,
  }, AsyncOperation);
  return res.status(202).send({ asyncOperationId: asyncOperation.id });
}

router.post('/', startKinesisReplayAsyncOperation, asyncOperationEndpointErrorHandler);

module.exports = router;
