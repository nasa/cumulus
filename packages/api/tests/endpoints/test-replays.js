'use strict';

const test = require('ava');
const sinon = require('sinon');
const request = require('supertest');

const awsServices = require('@cumulus/aws-client/services');
const SQS = require('@cumulus/aws-client/SQS');
const { localStackConnectionEnv } = require('@cumulus/db');
const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const asyncOperations = require('@cumulus/async-operations');

const { EcsStartTaskError } = require('@cumulus/errors');

const { app } = require('../../app');
const { createFakeJwtAuthToken, setAuthorizedOAuthUsers } = require('../../lib/testUtils');
const AccessToken = require('../../models/access-tokens');

let accessTokenModel;
let jwtAuthToken;

/**
 * create a source queue
 *
 * @param {string} queueNamePrefix - prefix of the queue name
 * @param {string} visibilityTimeout - visibility timeout for queue messages
 * @returns {Object} - {queueUrl: <url>} queue created
 */
async function createSqsQueues(
  queueNamePrefix,
  visibilityTimeout = '300'
) {
  // source queue
  const queueName = `${queueNamePrefix}Queue`;
  const queueParms = {
    QueueName: queueName,
    Attributes: {
      VisibilityTimeout: visibilityTimeout,
    },
  };

  const { QueueUrl: queueUrl } = await awsServices.sqs().createQueue(queueParms).promise();
  return { queueName, queueUrl };
}

const envs = {
  TOKEN_SECRET: randomString(),
  AccessTokensTable: randomString(),
  AsyncOperationsTable: randomString(),
  CollectionsTable: randomString(),
  EcsCluster: randomString(),
  FallbackTopicArn: randomString(),
  ManualConsumerLambda: randomString(),
  ProvidersTable: randomString(),
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

  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  t.context.queues = await createSqsQueues(randomString());
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
  const asyncOperationStartStub = sinon.stub(asyncOperations, 'startAsyncOperation').resolves(
    { id: '1234' }
  );
  await request(app)
    .post('/replays')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({})
    .expect(400, /replay type is required/);
  asyncOperationStartStub.restore();
  t.false(asyncOperationStartStub.called);
});

test.serial('request to replays endpoint returns 400 if type is kinesis but no kinesisStream is specified', async (t) => {
  const asyncOperationStartStub = sinon.stub(asyncOperations, 'startAsyncOperation').resolves(
    { id: '1234' }
  );
  const body = {
    type: 'kinesis',
  };

  await request(app)
    .post('/replays')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /kinesisStream is required for kinesis-type replay/);

  asyncOperationStartStub.restore();
  t.false(asyncOperationStartStub.called);
});

test.serial('request to replays endpoint with valid kinesis parameters starts an AsyncOperation and returns its id', async (t) => {
  const asyncOperationStartStub = sinon.stub(asyncOperations, 'startAsyncOperation').resolves(
    { id: '1234' }
  );
  const body = {
    type: 'kinesis',
    kinesisStream: 'fakestream',
    endTimestamp: 12345678,
    startTimestamp: 12356789,
  };

  await request(app)
    .post('/replays')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(202);

  const { lambdaName, cluster, payload } = asyncOperationStartStub.args[0][0];
  t.true(asyncOperationStartStub.calledOnce);
  t.is(lambdaName, process.env.ManualConsumerLambda);
  t.is(cluster, process.env.EcsCluster);
  t.deepEqual(payload, body);

  asyncOperationStartStub.restore();
});

test.serial('request to /replays endpoint returns 500 if starting ECS task throws unexpected error', async (t) => {
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

test.serial('request to /replays endpoint returns 503 if starting ECS task throws unexpected error', async (t) => {
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
  const asyncOperationStartStub = sinon.stub(asyncOperations, 'startAsyncOperation').returns(
    new Promise((resolve) => resolve({ id: randomId('asyncOperationId') }))
  );
  asyncOperationStartStub.resetHistory();
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
    t.truthy(response.body.asyncOperationId);
    const {
      lambdaName,
      cluster,
      description,
      payload,
    } = asyncOperationStartStub.args[0][0];
    t.true(asyncOperationStartStub.calledOnce);
    t.is(cluster, process.env.EcsCluster);
    t.is(description, 'SQS Replay');
    t.is(lambdaName, process.env.ReplaySqsMessagesLambda);
    t.deepEqual(payload, body);
  } finally {
    asyncOperationStartStub.restore();
  }
});

test.serial('POST /replays/sqs does not start an async-operation without queueName', async (t) => {
  const asyncOperationStartStub = sinon.stub(asyncOperations, 'startAsyncOperation').returns(
    new Promise((resolve) => resolve({ id: randomId('asyncOperationId') }))
  );
  asyncOperationStartStub.resetHistory();
  try {
    await request(app)
      .post('/replays/sqs')
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send({})
      .expect(400);
    t.false(asyncOperationStartStub.called);
  } finally {
    asyncOperationStartStub.restore();
  }
});

test.serial('POST /replays/sqs returns Internal Server Error if SQS queue does not exist', async (t) => {
  const asyncOperationStartStub = sinon.stub(asyncOperations, 'startAsyncOperation').returns(
    new Promise((resolve) => resolve({ id: randomId('asyncOperationId') }))
  );
  asyncOperationStartStub.resetHistory();
  try {
    await request(app)
      .post('/replays/sqs')
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send({ queueName: 'some-queue' })
      .expect(500);
    t.false(asyncOperationStartStub.called);
  } finally {
    asyncOperationStartStub.restore();
  }
});
