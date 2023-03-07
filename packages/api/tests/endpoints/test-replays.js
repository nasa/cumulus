'use strict';

const test = require('ava');
const sinon = require('sinon');
const request = require('supertest');

const SQS = require('@cumulus/aws-client/SQS');
const { localStackConnectionEnv } = require('@cumulus/db');
const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const asyncOperations = require('@cumulus/async-operations');

const { EcsStartTaskError } = require('@cumulus/errors');

const { app } = require('../../app');
const { createFakeJwtAuthToken, createSqsQueues, setAuthorizedOAuthUsers } = require('../../lib/testUtils');
const AccessToken = require('../../models/access-tokens');

const {
  startKinesisReplayAsyncOperation,
  startSqsMessagesReplay,
} = require('../../endpoints/replays');

const { buildFakeExpressResponse } = require('./utils');

let accessTokenModel;
let jwtAuthToken;

const envs = {
  TOKEN_SECRET: randomString(),
  AccessTokensTable: randomString(),
  AsyncOperationsTable: randomString(),
  EcsCluster: randomString(),
  FallbackTopicArn: randomString(),
  ManualConsumerLambda: randomString(),
  RulesTable: randomString(),
  stackName: randomString(),
  system_bucket: randomString(),
  ReplaySqsMessagesLambda: randomString(),
};

test.before(async (t) => {
  process.env = { ...process.env, ...localStackConnectionEnv };
  Object.keys(envs).forEach((key) => {
    process.env[key] = envs[key];
  });

  await s3().createBucket({ Bucket: process.env.system_bucket });

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  t.context.queues = await createSqsQueues(randomString());
});

test.beforeEach((t) => {
  t.context.asyncOperationId = randomString();
  t.context.asyncOperationStartStub = sinon.stub(asyncOperations, 'startAsyncOperation')
    .resolves({ id: t.context.asyncOperationId });
});

test.afterEach.always((t) => {
  t.context.asyncOperationStartStub.restore();
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await SQS.deleteQueue(t.context.queues.queueUrl);

  Object.keys(envs).forEach((key) => {
    delete process.env[key];
  });
});

test.serial('request to replays endpoint returns 400 when no type is specified', async (t) => {
  await request(app)
    .post('/replays')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({})
    .expect(400, /replay type is required/);

  t.false(t.context.asyncOperationStartStub.called);
});

test.serial('request to replays endpoint returns 400 if type is kinesis but no kinesisStream is specified', async (t) => {
  const body = {
    type: 'kinesis',
  };

  await request(app)
    .post('/replays')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /kinesisStream is required for kinesis-type replay/);

  t.false(t.context.asyncOperationStartStub.called);
});

test.serial('request to replays endpoint with valid kinesis parameters starts an AsyncOperation and returns its id', async (t) => {
  const body = {
    type: 'kinesis',
    kinesisStream: 'fakestream',
    endTimestamp: 12345678,
    startTimestamp: 12356789,
  };

  const response = await request(app)
    .post('/replays')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(202);

  t.is(response.body.asyncOperationId, t.context.asyncOperationId);
  const { lambdaName, cluster, payload } = t.context.asyncOperationStartStub.args[0][0];
  t.true(t.context.asyncOperationStartStub.calledOnce);
  t.is(lambdaName, process.env.ManualConsumerLambda);
  t.is(cluster, process.env.EcsCluster);
  t.deepEqual(payload, body);
});

test.serial('startKinesisReplayAsyncOperation() uses correct caller lambda function name', async (t) => {
  const { asyncOperationStartStub } = t.context;

  const body = {
    type: 'kinesis',
    kinesisStream: 'fakestream',
    endTimestamp: 12345678,
    startTimestamp: 12356789,
  };

  const functionName = randomId('lambda');

  await startKinesisReplayAsyncOperation(
    {
      apiGateway: {
        context: {
          functionName,
        },
      },
      body,
    },
    buildFakeExpressResponse()
  );

  t.is(asyncOperationStartStub.getCall(0).firstArg.callerLambdaName, functionName);
});

test.serial('request to /replays endpoint returns 500 if starting ECS task throws generic error', async (t) => {
  t.context.asyncOperationStartStub.restore();
  const asyncOperationStartStub = sinon.stub(asyncOperations, 'startAsyncOperation').throws(
    new Error('failed to start')
  );

  const body = {
    type: 'kinesis',
    kinesisStream: 'fakestream',
    endTimestamp: 12345678,
    startTimestamp: 12356789,
  };

  try {
    const response = await request(app)
      .post('/replays')
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send(body);
    t.is(response.status, 500);
  } finally {
    asyncOperationStartStub.restore();
  }
});

test.serial('request to /replays endpoint returns 503 if starting ECS task throws EcsStartTaskError', async (t) => {
  t.context.asyncOperationStartStub.restore();
  const asyncOperationStartStub = sinon.stub(asyncOperations, 'startAsyncOperation').throws(
    new EcsStartTaskError('failed to start')
  );

  const body = {
    type: 'kinesis',
    kinesisStream: 'fakestream',
    endTimestamp: 12345678,
    startTimestamp: 12356789,
  };
  try {
    const response = await request(app)
      .post('/replays')
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send(body);
    t.is(response.status, 503);
  } finally {
    asyncOperationStartStub.restore();
  }
});

test.serial('POST /replays/sqs starts an async-operation with specified payload', async (t) => {
  const { queues } = t.context;

  const body = {
    queueName: queues.queueName,
  };

  try {
    const response = await request(app)
      .post('/replays/sqs')
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send(body)
      .expect(202);

    // expect a returned async operation ID
    t.is(response.body.asyncOperationId, t.context.asyncOperationId);
    const {
      lambdaName,
      cluster,
      description,
      payload,
    } = t.context.asyncOperationStartStub.args[0][0];
    t.true(t.context.asyncOperationStartStub.calledOnce);
    t.is(cluster, process.env.EcsCluster);
    t.is(description, 'SQS Replay');
    t.is(lambdaName, process.env.ReplaySqsMessagesLambda);
    t.deepEqual(payload, body);
  } finally {
    t.context.asyncOperationStartStub.restore();
  }
});

test.serial('startSqsMessagesReplay() uses correct caller lambda function name', async (t) => {
  const { asyncOperationStartStub, queues } = t.context;

  const body = {
    queueName: queues.queueName,
  };

  const functionName = randomId('lambda');

  await startSqsMessagesReplay(
    {
      apiGateway: {
        context: {
          functionName,
        },
      },
      body,
    },
    buildFakeExpressResponse()
  );

  t.is(asyncOperationStartStub.getCall(0).firstArg.callerLambdaName, functionName);
});

test.serial('POST /replays/sqs does not start an async-operation without queueName', async (t) => {
  await request(app)
    .post('/replays/sqs')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({})
    .expect(400);
  t.false(t.context.asyncOperationStartStub.called);
});

test.serial('POST /replays/sqs returns an error if SQS queue does not exist', async (t) => {
  const response = await request(app)
    .post('/replays/sqs')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ queueName: 'some-queue' })
    .expect(400);
  t.false(t.context.asyncOperationStartStub.called);
  t.true(response.body.message.includes('AWS.SimpleQueueService.NonExistentQueue'));
});
