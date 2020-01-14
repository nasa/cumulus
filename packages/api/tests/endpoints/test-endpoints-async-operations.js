'use strict';

const test = require('ava');
const request = require('supertest');
const { s3 } = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket
} = require('@cumulus/aws-client/S3');
const { noop } = require('@cumulus/common/util');
const { randomString } = require('@cumulus/common/test-utils');
const {
  AccessToken,
  AsyncOperation: AsyncOperationModel
} = require('../../models');
const { createFakeJwtAuthToken, setAuthorizedOAuthUsers } = require('../../lib/testUtils');

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

test.before(async () => {
  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  // Create AsyncOperations table
  asyncOperationModel = new AsyncOperationModel({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
    tableName: process.env.AsyncOperationsTable
  });
  await asyncOperationModel.createTable();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await asyncOperationModel.deleteTable().catch(noop);
  await accessTokenModel.deleteTable().catch(noop);
});

test.serial('GET /asyncOperations returns a list of operations', async (t) => {
  const asyncOperation1 = {
    id: 'abc-789',
    status: 'RUNNING',
    taskArn: randomString(),
    description: 'Some async run',
    operationType: 'Bulk Granules',
    output: JSON.stringify({ age: 59 })
  };
  const asyncOperation2 = {
    id: 'abc-456',
    status: 'RUNNING',
    taskArn: randomString(),
    description: 'Some async run',
    operationType: 'ES Index',
    output: JSON.stringify({ age: 37 })
  };

  await asyncOperationModel.create(asyncOperation1);
  await asyncOperationModel.create(asyncOperation2);

  const response = await request(app)
    .get('/asyncOperations')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.status, 200);

  response.body.Items.forEach((item) => {
    if (item.id === asyncOperation1.id) {
      t.is(item.description, asyncOperation1.description);
      t.is(item.operationType, asyncOperation1.operationType);
      t.is(item.status, asyncOperation1.status);
      t.is(item.output, asyncOperation1.output);
      t.is(item.taskArn, asyncOperation1.taskArn);
    } else if (item.id === asyncOperation2.id) {
      t.is(item.description, asyncOperation2.description);
      t.is(item.operationType, asyncOperation2.operationType);
      t.is(item.status, asyncOperation2.status);
      t.is(item.output, asyncOperation2.output);
      t.is(item.taskArn, asyncOperation2.taskArn);
    }
  });
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
    description: 'Some async run',
    operationType: 'ES Index',
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
      description: asyncOperation.description,
      operationType: asyncOperation.operationType,
      status: asyncOperation.status,
      output: asyncOperation.output,
      taskArn: asyncOperation.taskArn
    }
  );
});
