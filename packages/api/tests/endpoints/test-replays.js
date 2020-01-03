'use strict';

const test = require('ava');
const sinon = require('sinon');
const request = require('supertest');

const { randomString } = require('@cumulus/common/test-utils');

const { app } = require('../../app');
const { createFakeJwtAuthToken } = require('../../lib/testUtils');
const models = require('../../models');

let userModel;
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
  UsersTable: randomString(),
  stackName: randomString(),
  system_bucket: randomString()
};

test.before(async () => {
  Object.keys(envs).forEach((key) => {
    process.env[key] = envs[key];
  });

  userModel = new models.User();
  await userModel.createTable();
  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });
});

test.after.always(async () => {
  await userModel.deleteTable();
  await accessTokenModel.deleteTable();

  Object.keys(envs).forEach((key) => {
    delete process.env[key];
  });
});

test.serial('request to replays endpoint returns 400 when no type is specified', async (t) => {
  const asyncOperationStartStub = sinon.stub(models.AsyncOperation.prototype, 'start').returns(
    Promise.resolve({ id: '1234' })
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
  const asyncOperationStartStub = sinon.stub(models.AsyncOperation.prototype, 'start').returns(
    Promise.resolve({ id: '1234' })
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
  const asyncOperationStartStub = sinon.stub(models.AsyncOperation.prototype, 'start').returns(
    Promise.resolve({ id: '1234' })
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
  t.deepEqual(payload, {
    CollectionsTable: process.env.CollectionsTable,
    RulesTable: process.env.RulesTable,
    ProvidersTable: process.env.ProvidersTable,
    stackName: process.env.stackName,
    system_bucket: process.env.system_bucket,
    FallbackTopicArn: process.env.KinesisFallbackTopicArn,
    ...body
  });

  asyncOperationStartStub.restore();
});
