//@ts-check

'use strict';

const router = require('express-promise-router')();
const { z } = require('zod');
const isError = require('lodash/isError');

const asyncOperations = require('@cumulus/async-operations');

const { zodParser } = require('../src/zod-utils');

const { asyncOperationEndpointErrorHandler } = require('../app/middleware');
const { getFunctionNameFromRequestContext } = require('../lib/request');
const { returnCustomValidationErrors } = require('../lib/endpoints');

const zodStringNumberUnion = z.union([
  z.string().transform((val) => {
    const num = Number(val);
    if (Number.isNaN(num)) {
      throw new TypeError('Invalid number');
    }
    return num;
  }),
  z.number(),
]).pipe(z.number().int().positive().optional());

const postRecoverCumulusMessagesSchema = z.object({
  bucket: z.string().optional(),
  path: z.string().optional(),
  batchSize: zodStringNumberUnion.default(1000),
  concurrency: zodStringNumberUnion.default(30),
  maxDbPool: zodStringNumberUnion.default(60),
}).passthrough();

const parsePostRecoverCumulusMessagesPayload = zodParser('Post Recover Cumulus Message Payload', postRecoverCumulusMessagesSchema);

async function postRecoverCumulusMessages(req, res) {
  const stackName = process.env.stackName;
  const systemBucket = process.env.system_bucket;

  const messageBody = parsePostRecoverCumulusMessagesPayload(req.body ?? {});
  if (isError(messageBody)) {
    return returnCustomValidationErrors(res, messageBody);
  }
  const {
    bucket,
    path,
    batchSize,
    concurrency,
    dbMaxPool,
  } = messageBody;

  const asyncOperation = await asyncOperations.startAsyncOperation({
    cluster: process.env.EcsCluster,
    callerLambdaName: getFunctionNameFromRequestContext(req),
    lambdaName: process.env.DeadLetterProcessingLambda,
    asyncOperationTaskDefinition: process.env.DeadLetterRecoveryTaskDefinition,
    description: 'Dead-Letter Processor ECS Run',
    operationType: 'Dead-Letter Processing',
    payload: {
      batchSize,
      bucket,
      concurrency,
      path,
    },
    stackName,
    systemBucket,
    knexConfig: { ...process.env, dbMaxPool },
    useLambdaEnvironmentVariables: true,
  });
  return res.status(202).send(asyncOperation);
}

router.post(
  '/recoverCumulusMessages',
  postRecoverCumulusMessages,
  asyncOperationEndpointErrorHandler
);
module.exports = {
  postRecoverCumulusMessages,
  router,
};
