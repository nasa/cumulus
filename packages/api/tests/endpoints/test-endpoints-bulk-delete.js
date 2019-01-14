'use strict';

const test = require('ava');
const request = require('supertest');
const {
  testUtils: { randomString }
} = require('@cumulus/common');
const { AccessToken, User } = require('../../models');
const { createFakeJwtAuthToken } = require('../../lib/testUtils');

let accessTokenModel;
let jwtAuthToken;
let userModel;

process.env.AsyncOperationsTable = randomString();
process.env.AsyncOperationTaskDefinition = randomString();
process.env.BulkDeleteLambda = randomString();
process.env.EcsCluster = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.UsersTable = randomString();
process.env.TOKEN_SECRET = randomString();
process.env.AccessTokensTable = randomString();

// import the express app after setting the env variables
const { app } = require('../../app');

test.before(async () => {
  // Create Users table
  process.env.UsersTable = randomString();
  userModel = new User();
  await userModel.createTable();

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });
});

test.after.always(async () => {
  try {
    await userModel.deleteTable();
  }
  catch (err) {
    if (err.code !== 'ResourceNotFoundException') throw err;
  }

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
