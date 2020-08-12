'use strict';

const test = require('ava');
const sinon = require('sinon');
const request = require('supertest');

const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const { EcsStartTaskError } = require('@cumulus/errors');

const { app } = require('../../app');
const { createFakeJwtAuthToken, setAuthorizedOAuthUsers } = require('../../lib/testUtils');
const AccessToken = require('../../models/access-tokens');
const AsyncOperation = require('../../models/async-operation');

let accessTokenModel;
let jwtAuthToken;

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
  system_bucket: randomString()
};

test.before(async () => {
  Object.keys(envs).forEach((key) => {
    process.env[key] = envs[key];
  });

  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);

  Object.keys(envs).forEach((key) => {
    delete process.env[key];
  });
});

test.serial('request to replays endpoint returns 400 when no type is specified', async (t) => {
  const asyncOperationStartStub = sinon.stub(AsyncOperation.prototype, 'start').resolves(
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
  const asyncOperationStartStub = sinon.stub(AsyncOperation.prototype, 'start').resolves(
    { id: '1234' }
  );

  const body = {
    type: 'kinesis'
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
  const asyncOperationStartStub = sinon.stub(AsyncOperation.prototype, 'start').resolves(
    { id: '1234' }
  );

  const body = {
    type: 'kinesis',
    kinesisStream: 'fakestream',
    endTimestamp: 12345678,
    startTimestamp: 12356789
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
  const asyncOperationStartStub = sinon.stub(AsyncOperation.prototype, 'start').throws(
    new Error('failed to start')
  );

  const body = {
    type: 'kinesis',
    kinesisStream: 'fakestream',
    endTimestamp: 12345678,
    startTimestamp: 12356789
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
  const asyncOperationStartStub = sinon.stub(AsyncOperation.prototype, 'start').throws(
    new EcsStartTaskError('failed to start')
  );

  const body = {
    type: 'kinesis',
    kinesisStream: 'fakestream',
    endTimestamp: 12345678,
    startTimestamp: 12356789
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
