'use strict';

const test = require('ava');
const request = require('supertest');
const sinon = require('sinon');

const { s3 } = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const { EcsStartTaskError } = require('@cumulus/errors');

const {
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers
} = require('../../../lib/testUtils');
const AccessToken = require('../../../models/access-tokens');
const AsyncOperation = require('../../../models/async-operation');

let accessTokenModel;
let jwtAuthToken;

// import the express app after setting the env variables
const { app } = require('../../../app');

test.before(async () => {
  process.env.AsyncOperationsTable = randomString();
  process.env.AsyncOperationTaskDefinition = randomString();
  process.env.BulkOperationLambda = randomString();
  process.env.EcsCluster = randomString();
  process.env.stackName = randomString();
  process.env.system_bucket = randomString();
  process.env.TOKEN_SECRET = randomString();
  process.env.AccessTokensTable = randomString();
  process.env.METRICS_ES_HOST = randomString();
  process.env.METRICS_ES_USER = randomString();
  process.env.METRICS_ES_PASS = randomString();

  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
});

test.beforeEach((t) => {
  const asyncOperationId = randomString();
  t.context.asyncOperationStartStub = sinon.stub(AsyncOperation.prototype, 'start').returns(
    new Promise((resolve) => resolve({ id: asyncOperationId }))
  );
});

test.afterEach.always((t) => {
  t.context.asyncOperationStartStub.restore();
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await accessTokenModel.deleteTable();
});

test.serial('POST /granules/bulkDelete starts an async-operation with the correct payload and list of IDs', async (t) => {
  const { asyncOperationStartStub } = t.context;
  const expectedIds = ['MOD09GQ.A8592978.nofTNT.006.4914003503063'];

  const body = {
    ids: expectedIds,
    forceRemoveFromCmr: true
  };

  await request(app)
    .post('/granules/bulkDelete')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(202);
  const {
    lambdaName,
    cluster,
    description,
    payload
  } = asyncOperationStartStub.args[0][0];
  t.true(asyncOperationStartStub.calledOnce);
  t.is(lambdaName, process.env.BulkOperationLambda);
  t.is(cluster, process.env.EcsCluster);
  t.is(description, 'Bulk granule deletion');
  t.deepEqual(payload, {
    payload: body,
    type: 'BULK_GRANULE_DELETE',
    granulesTable: process.env.GranulesTable,
    esHost: process.env.METRICS_ES_HOST,
    esUser: process.env.METRICS_ES_USER,
    esPassword: process.env.METRICS_ES_PASS
  });
});

test.serial('POST /granules/bulkDelete starts an async-operation with the correct payload and ES query', async (t) => {
  const { asyncOperationStartStub } = t.context;
  const expectedIndex = 'my-index';
  const expectedQuery = { query: 'fake-query', size: 2 };

  const body = {
    index: expectedIndex,
    query: expectedQuery
  };

  await request(app)
    .post('/granules/bulkDelete')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(202);

  const {
    lambdaName,
    cluster,
    description,
    payload
  } = asyncOperationStartStub.args[0][0];
  t.true(asyncOperationStartStub.calledOnce);
  t.is(lambdaName, process.env.BulkOperationLambda);
  t.is(cluster, process.env.EcsCluster);
  t.is(description, 'Bulk granule deletion');
  t.deepEqual(payload, {
    payload: body,
    type: 'BULK_GRANULE_DELETE',
    granulesTable: process.env.GranulesTable,
    esHost: process.env.METRICS_ES_HOST,
    esUser: process.env.METRICS_ES_USER,
    esPassword: process.env.METRICS_ES_PASS
  });
});

test.serial('POST /granules/bulkDelete returns a 400 when a query is provided with no index', async (t) => {
  const { asyncOperationStartStub } = t.context;
  const expectedQuery = { query: 'fake-query' };

  const body = {
    query: expectedQuery
  };

  await request(app)
    .post('/granules/bulkDelete')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /Index is required if query is sent/);

  t.true(asyncOperationStartStub.notCalled);
});

test.serial('POST /granules/bulkDelete returns 400 when no IDs or Query is provided', async (t) => {
  const { asyncOperationStartStub } = t.context;

  const body = {};
  await request(app)
    .post('/granules/bulkDelete')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /One of ids or query is required/);

  t.true(asyncOperationStartStub.notCalled);
});

test.serial('POST /granules/bulkDelete returns 400 when the Metrics ELK stack is not configured', async (t) => {
  const { asyncOperationStartStub } = t.context;

  const body = {
    query: 'fake-query'
  };

  delete process.env.METRICS_ES_HOST;
  t.teardown(() => {
    process.env.METRICS_ES_HOST = randomString();
  });

  await request(app)
    .post('/granules/bulkDelete')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /ELK Metrics stack not configured/);

  t.true(asyncOperationStartStub.notCalled);
});

test.serial('POST /granules/bulkDelete returns a 401 status code if valid authorization is not specified', async (t) => {
  const response = await request(app)
    .post('/granules/bulkDelete')
    .set('Accept', 'application/json')
    .expect(401);

  t.is(response.status, 401);
});

test.serial('request to /granules/bulkDelete endpoint returns 500 if starting ECS task throws unexpected error', async (t) => {
  t.context.asyncOperationStartStub.restore();
  t.context.asyncOperationStartStub = sinon.stub(AsyncOperation.prototype, 'start').throws(
    new Error('failed to start')
  );

  const body = {
    ids: [randomString()]
  };

  const response = await request(app)
    .post('/granules/bulkDelete')
    .send(body)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);
  t.is(response.status, 500);
});

test.serial('request to /granules/bulkDelete endpoint returns 503 if starting ECS task throws unexpected error', async (t) => {
  t.context.asyncOperationStartStub.restore();
  t.context.asyncOperationStartStub = sinon.stub(AsyncOperation.prototype, 'start').throws(
    new EcsStartTaskError('failed to start')
  );

  const body = {
    ids: [randomString()]
  };

  const response = await request(app)
    .post('/granules/bulkDelete')
    .send(body)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);
  t.is(response.status, 503);
});
