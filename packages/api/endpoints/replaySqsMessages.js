'use strict';

const asyncOperations = require('@cumulus/async-operations');
const Logger = require('@cumulus/logger');
const router = require('express-promise-router')();
const { getQueueUrlByName, sqsQueueExists } = require('@cumulus/aws-client/SQS');

const AsyncOperation = require('../models/async-operation');
const { asyncOperationEndpointErrorHandler } = require('../app/middleware');

const logger = new Logger({ sender: '@cumulus/api/replay-archived-messages' });
async function startArchivedMessagesReplay(req, res) {
  const tableName = process.env.AsyncOperationsTable;
  const stackName = process.env.stackName;
  const systemBucket = process.env.system_bucket;

  const payload = req.body;
  logger.debug(`Payload is ${JSON.stringify(payload)}`);

  if (!payload.type) {
    return res.boom.badRequest('replay type is required');
  }

  if (payload.type === 'sqs' && !payload.queueName) {
    return res.boom.badRequest('queueName is required for SQS messages replay');
  }

  const queueUrl = await getQueueUrlByName(payload.queueName);
  if (!(await sqsQueueExists(queueUrl))) {
    logger.info(`Could not find queue ${queueUrl}. Unable to process message.`);
  }
  const asyncOperation = await asyncOperations.startAsyncOperation({
    asyncOperationTaskDefinition: process.env.AsyncOperationTaskDefinition,
    cluster: process.env.EcsCluster,
    description: 'SQS Replay',
    dynamoTableName: tableName,
    knexConfig: process.env,
    lambdaName: process.env.ReplaySQSMessagesLambda,
    operationType: 'SQS Replay',
    payload,
    stackName,
    systemBucket,
    useLambdaEnvironmentVariables: true,
  }, AsyncOperation);
  return res.status(202).send({ asyncOperationId: asyncOperation.id });
}

router.post('/', startArchivedMessagesReplay, asyncOperationEndpointErrorHandler);

module.exports = router;
