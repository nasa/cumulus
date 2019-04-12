'use strict';

const test = require('ava');
const request = require('supertest');
const {
  testUtils: { randomString }
} = require('@cumulus/common');
const {
  AccessToken,
  AsyncOperation: AsyncOperationModel,
  User
} = require('../../models');
const { createFakeJwtAuthToken } = require('../../lib/testUtils');

process.env.UsersTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.AsyncOperationsTable = randomString();
process.env.AccessTokensTable = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../app');

let jwtAuthToken;
let asyncOperationModel;
let accessTokenModel;
let userModel;

test.before(async () => {
  // Create AsyncOperations table
  asyncOperationModel = new AsyncOperationModel({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
    tableName: process.env.AsyncOperationsTable
  });
  await asyncOperationModel.createTable();

  // Create Users table
  userModel = new User();
  await userModel.createTable();

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });
});

test.after.always(async () => {
  try {
    await asyncOperationModel.deleteTable();
  } catch (err) {
    if (err.code !== 'ResourceNotFoundException') throw err;
  }

  try {
    await userModel.deleteTable();
  } catch (err) {
    if (err.code !== 'ResourceNotFoundException') throw err;
  }

  await accessTokenModel.deleteTable();
});

test.serial('GET /asyncOperations returns a 404 status code', async (t) => {
  const response = await request(app)
    .get('/asyncOperations')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);

  t.is(response.status, 404);
});

test.serial('GET /asyncOperations/{:id} returns a 401 status code if valid authorization is not specified', async (t) => {
  const response = await request(app)
    .get('/asyncOperations/abc-123')
    .set('Accept', 'application/json')
    .expect(401);

  t.is(response.status, 401);
});

test.serial('GET /asyncOperations/{:id} returns a 404 status code if the requested async-operation does not exist', async (t) => {
  const response = await request(app)
    .get('/asyncOperations/abc-123')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);

  t.is(response.status, 404);
});

test.serial('GET /asyncOperations/{:id} returns the async operation if it does exist', async (t) => {
  const asyncOperation = {
    id: 'abc-123',
    status: 'RUNNING',
    taskArn: randomString(),
    output: JSON.stringify({ age: 37 })
  };

  const createdAsyncOperation = await asyncOperationModel.create(asyncOperation);

  const response = await request(app)
    .get(`/asyncOperations/${createdAsyncOperation.id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.status, 200);

  t.deepEqual(
    response.body,
    {
      id: asyncOperation.id,
      status: asyncOperation.status,
      output: asyncOperation.output,
      taskArn: asyncOperation.taskArn
    }
  );
});
