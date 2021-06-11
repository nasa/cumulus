'use strict';

const test = require('ava');
const request = require('supertest');
const sinon = require('sinon');
const noop = require('lodash/noop');
const { s3 } = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const {
  localStackConnectionEnv,
  generateLocalTestDb,
  destroyLocalTestDb,
  AsyncOperationPgModel,
} = require('@cumulus/db');
const { Search } = require('@cumulus/es-client/search');
const indexer = require('@cumulus/es-client/indexer');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');

const { migrationDir } = require('../../../../lambdas/db-migration');

const {
  del,
} = require('../../endpoints/async-operations');
const {
  AccessToken,
  AsyncOperation: AsyncOperationModel,
} = require('../../models');
const {
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers,
  createAsyncOperationTestRecords,
} = require('../../lib/testUtils');

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

const testDbName = randomId('async_operations_test');

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.testKnexAdmin = knexAdmin;

  t.context.asyncOperationPgModel = new AsyncOperationPgModel();

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.esAsyncOperationClient = new Search(
    {},
    'asyncOperation',
    t.context.esIndex
  );

  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  // Create AsyncOperations table
  asyncOperationModel = new AsyncOperationModel({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
    tableName: process.env.AsyncOperationsTable,
  });
  t.context.asyncOperationModel = asyncOperationModel;
  await asyncOperationModel.createTable();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await asyncOperationModel.deleteTable().catch(noop);
  await accessTokenModel.deleteTable().catch(noop);
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
  await cleanupTestIndex(t.context);
});

test.serial('GET /asyncOperations returns a list of operations', async (t) => {
  const asyncOperation1 = {
    id: 'abc-789',
    status: 'RUNNING',
    taskArn: randomString(),
    description: 'Some async run',
    operationType: 'Bulk Granules',
    output: JSON.stringify({ age: 59 }),
  };
  const asyncOperation2 = {
    id: 'abc-456',
    status: 'RUNNING',
    taskArn: randomString(),
    description: 'Some async run',
    operationType: 'ES Index',
    output: JSON.stringify({ age: 37 }),
  };

  await asyncOperationModel.create(asyncOperation1);
  await indexer.indexAsyncOperation(t.context.esClient, asyncOperation1, t.context.esIndex);
  await asyncOperationModel.create(asyncOperation2);
  await indexer.indexAsyncOperation(t.context.esClient, asyncOperation2, t.context.esIndex);

  const response = await request(app)
    .get('/asyncOperations')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.status, 200);

  response.body.results.forEach((item) => {
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

test.serial('GET /asyncOperations with a timestamp parameter returns a list of filtered results', async (t) => {
  const firstDate = Date.now();
  const asyncOperation1 = {
    id: 'abc-6295',
    status: 'RUNNING',
    taskArn: randomString(),
    description: 'Some async run',
    operationType: 'Bulk Granules',
    output: JSON.stringify({ age: 59 }),
  };
  const asyncOperation2 = {
    id: 'abc-294',
    status: 'RUNNING',
    taskArn: randomString(),
    description: 'Some async run',
    operationType: 'ES Index',
    output: JSON.stringify({ age: 37 }),
  };

  await asyncOperationModel.create(asyncOperation1);
  await indexer.indexAsyncOperation(t.context.esClient, asyncOperation1, t.context.esIndex);

  const secondDate = Date.now();

  await asyncOperationModel.create(asyncOperation2);
  await indexer.indexAsyncOperation(t.context.esClient, asyncOperation2, t.context.esIndex);

  const response1 = await request(app)
    .get(`/asyncOperations?timestamp__from=${firstDate}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response1.status, 200);
  t.is(response1.body.results.length, 2);

  const response2 = await request(app)
    .get(`/asyncOperations?timestamp__from=${secondDate}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response2.body.results.length, 1);
  t.is(response2.body.results[0].id, asyncOperation2.id);
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
    output: JSON.stringify({ age: 37 }),
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
      taskArn: asyncOperation.taskArn,
    }
  );
});

test('del() returns a 401 bad request if id is not provided', async (t) => {
  const fakeRequest = {};
  const fakeResponse = {
    boom: {
      badRequest: sinon.stub(),
    },
  };
  await del(fakeRequest, fakeResponse);
  t.true(fakeResponse.boom.badRequest.called);
});

test('DELETE deletes the async operation from all data stores', async (t) => {
  const {
    originalDynamoAsyncOperation,
  } = await createAsyncOperationTestRecords(t.context);
  const { id } = originalDynamoAsyncOperation;

  t.true(await asyncOperationModel.exists({ id }));
  t.true(
    await t.context.asyncOperationPgModel.exists(t.context.knex, { id })
  );

  const response = await request(app)
    .delete(`/asyncOperations/${id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { message } = response.body;

  t.is(message, 'Record deleted');
  t.false(await asyncOperationModel.exists({ id }));
  const dbRecords = await t.context.asyncOperationPgModel
    .search(t.context.knex, { id });
  t.is(dbRecords.length, 0);
});
