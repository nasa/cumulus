'use strict';

const router = require('express-promise-router')();
const asyncOperations = require('@cumulus/async-operations');

const { asyncOperationEndpointErrorHandler } = require('../app/middleware');

const { getFunctionNameFromRequestContext } = require('../lib/request');

async function postRecoverCumulusMessages(req, res) {
  const stackName = process.env.stackName;
  const systemBucket = process.env.system_bucket;

  const { bucket, path } = (req.body === undefined ? {} : req.body);
  const asyncOperation = await asyncOperations.startAsyncOperation({
    cluster: process.env.EcsCluster,
    callerLambdaName: getFunctionNameFromRequestContext(req),
    lambdaName: process.env.DeadLetterProcessingLambda,
    asyncOperationTaskDefinition: process.env.AsyncOperationTaskDefinition,
    description: 'Dead-Letter Processor ECS Run',
    operationType: 'Dead-Letter Processing',
    payload: {
      bucket,
      path,
    },
    stackName,
    systemBucket,
    knexConfig: process.env,
    useLambdaEnvironmentVariables: true,
  });
  return res.status(202).send(asyncOperation);
}

router.post('/recoverCumulusMessages', postRecoverCumulusMessages, asyncOperationEndpointErrorHandler);
module.exports = {
  postRecoverCumulusMessages,
  router,
};
