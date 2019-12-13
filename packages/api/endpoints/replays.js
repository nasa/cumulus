'use strict';

const router = require('express-promise-router')();
const { AsyncOperation } = require('../models');

/**
 * Start an AsyncOperation that will perform kinesis message replay
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function startKinesisReplayAsyncOperation(req, res) {
  const asyncOperationModel = new AsyncOperation({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
    tableName: process.env.AsyncOperationsTable
  });

  const payload = req.body;

  if (!payload.type) {
    return res.boom.badRequest('replay type is required');
  }

  if (payload.type === 'kinesis' && !payload.kinesisStream) {
    return res.boom.badRequest('kinesisStream is required for kinesis-type replay');
  }

  const input = {
    CollectionsTable: process.env.CollectionsTable,
    RulesTable: process.env.RulesTable,
    ProvidersTable: process.env.ProvidersTable,
    stackName: process.env.stackName,
    system_bucket: process.env.system_bucket,
    FallbackTopicArn: process.env.KinesisFallbackTopicArn,
    ...payload
  };

  let asyncOperation;
  try {
    asyncOperation = await asyncOperationModel.start({
      asyncOperationTaskDefinition: process.env.AsyncOperationTaskDefinition,
      cluster: process.env.EcsCluster,
      lambdaName: process.env.ManualConsumerLambda,
      payload: input
    });
  } catch (err) {
    if (err.name !== 'EcsStartTaskError') throw err;

    return res.boom.serverUnavailable(`Failed to run ECS task: ${err.message}`);
  }

  return res.status(202).send({ asyncOperationId: asyncOperation.id });
}

router.post('/', startKinesisReplayAsyncOperation);

module.exports = router;
