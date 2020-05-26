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

const AccessToken = require('../../models/access-tokens');
const AsyncOperation = require('../../models/async-operation');
const { createFakeJwtAuthToken, setAuthorizedOAuthUsers } = require('../../lib/testUtils');

let accessTokenModel;
let jwtAuthToken;

process.env.AsyncOperationsTable = randomString();
process.env.AsyncOperationTaskDefinition = randomString();
process.env.BulkDeleteLambda = randomString();
process.env.EcsCluster = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();
process.env.AccessTokensTable = randomString();

// import the express app after setting the env variables
const { app } = require('../../app');

test.before(async () => {
  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await accessTokenModel.deleteTable();
});

test.serial('GET /bulkDelete returns a 404 status code', async (t) => {
  const response = await request(app)
    .get('/bulkDelete')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);

  t.is(response.status, 404);
});

test.serial('POST /bulkDelete returns a 401 status code if valid authorization is not specified', async (t) => {
  const response = await request(app)
    .post('/bulkDelete')
    .set('Accept', 'application/json')
    .expect(401);

  t.is(response.status, 401);
});

test.serial('request to /bulkDelete endpoint returns 500 if starting ECS task throws unexpected error', async (t) => {
  const asyncOperationStartStub = sinon.stub(AsyncOperation.prototype, 'start').throws(
    new Error('failed to start')
  );

  try {
    const response = await request(app)
      .post('/bulkDelete')
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`);
    t.is(response.status, 500);
  } finally {
    asyncOperationStartStub.restore();
  }
});

test.serial('request to /bulkDelete endpoint returns 503 if starting ECS task throws unexpected error', async (t) => {
  const asyncOperationStartStub = sinon.stub(AsyncOperation.prototype, 'start').throws(
    new EcsStartTaskError('failed to start')
  );

  try {
    const response = await request(app)
      .post('/bulkDelete')
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`);
    t.is(response.status, 503);
  } finally {
    asyncOperationStartStub.restore();
  }
});
