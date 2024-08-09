'use strict';

const test = require('ava');
const request = require('supertest');
const sinon = require('sinon');
const noop = require('lodash/noop');
const { v4: uuidv4 } = require('uuid');

const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const {
  localStackConnectionEnv,
  generateLocalTestDb,
  destroyLocalTestDb,
  AsyncOperationPgModel,
  translateApiAsyncOperationToPostgresAsyncOperation,
  migrationDir,
} = require('@cumulus/db');
const { Search } = require('@cumulus/es-client/search');
const indexer = require('@cumulus/es-client/indexer');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');
const { fakeAsyncOperationFactory } = require('../../../lib/testUtils');

const {
  del,
} = require('../../../endpoints/async-operations');
const {
  AccessToken,
} = require('../../../models');
const {
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers,
  createAsyncOperationTestRecords,
} = require('../../../lib/testUtils');
const { buildFakeExpressResponse } = require('../utils');

process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.AccessTokensTable = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../../app');

let jwtAuthToken;
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

  await s3().createBucket({ Bucket: process.env.system_bucket });

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await accessTokenModel.deleteTable().catch(noop);
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
  await cleanupTestIndex(t.context);
});

test.serial('GET /asyncOperations returns a list of operations', async (t) => {
  const { esClient, esIndex } = t.context;
  const asyncOperation1 = fakeAsyncOperationFactory();
  const asyncOperation2 = fakeAsyncOperationFactory();

  const asyncOpPgRecord1 = translateApiAsyncOperationToPostgresAsyncOperation(asyncOperation1);
  await t.context.asyncOperationPgModel.create(t.context.knex, asyncOpPgRecord1);
  await indexer.indexAsyncOperation(esClient, asyncOperation1, esIndex);

  const asyncOpPgRecord2 = translateApiAsyncOperationToPostgresAsyncOperation(asyncOperation2);
  await t.context.asyncOperationPgModel.create(t.context.knex, asyncOpPgRecord2);
  await indexer.indexAsyncOperation(esClient, asyncOperation2, esIndex);

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
  const { esClient, esIndex } = t.context;
  const firstDate = Date.now();
  const asyncOperation1 = fakeAsyncOperationFactory();
  const asyncOperation2 = fakeAsyncOperationFactory();
  const asyncOpPgRecord1 = translateApiAsyncOperationToPostgresAsyncOperation(asyncOperation1);
  await t.context.asyncOperationPgModel.create(t.context.knex, asyncOpPgRecord1);
  await indexer.indexAsyncOperation(esClient, asyncOperation1, esIndex);

  const secondDate = Date.now();

  const asyncOpPgRecord2 = translateApiAsyncOperationToPostgresAsyncOperation(asyncOperation2);
  await t.context.asyncOperationPgModel.create(t.context.knex, asyncOpPgRecord2);
  await indexer.indexAsyncOperation(esClient, asyncOperation2, esIndex);

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
  const id = uuidv4();
  const response = await request(app)
    .get(`/asyncOperations/${id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);

  t.is(response.status, 404);
});

test.serial('GET /asyncOperations/{:id} returns the async operation if it does exist', async (t) => {
  const { asyncOperationPgModel } = t.context;
  const asyncOperation = fakeAsyncOperationFactory();
  const asyncOperationPgRecord = translateApiAsyncOperationToPostgresAsyncOperation(asyncOperation);
  await asyncOperationPgModel.create(t.context.knex, asyncOperationPgRecord);

  const response = await request(app)
    .get(`/asyncOperations/${asyncOperationPgRecord.id}`)
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

test('DELETE returns a 404 if PostgreSQL and Elasticsearch async operation cannot be found', async (t) => {
  const nonExistentAsyncOperation = fakeAsyncOperationFactory();
  const response = await request(app)
    .delete(`/asyncOperations/${nonExistentAsyncOperation.id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);
  t.is(response.body.message, 'No record found');
});

test('DELETE deletes async operation successfully if it exists in PostgreSQL but not Elasticsearch', async (t) => {
  const {
    asyncOperationPgModel,
    esAsyncOperationClient,
    knex,
  } = t.context;

  const originalAsyncOperation = fakeAsyncOperationFactory();
  const insertPgRecord = await translateApiAsyncOperationToPostgresAsyncOperation(
    originalAsyncOperation,
    knex
  );
  const id = insertPgRecord.id;
  await asyncOperationPgModel.create(
    knex,
    insertPgRecord
  );
  t.true(
    await asyncOperationPgModel.exists(knex, { id })
  );

  const response = await request(app)
    .delete(`/asyncOperations/${id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);
  const { message } = response.body;

  t.is(message, 'Record deleted');
  t.false(
    await asyncOperationPgModel.exists(knex, { id })
  );
  t.false(await esAsyncOperationClient.exists(
    id
  ));
});

test('DELETE deletes the async operation from all data stores', async (t) => {
  const {
    originalPgRecord,
  } = await createAsyncOperationTestRecords(t.context);
  const { id } = originalPgRecord;

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
  const dbRecords = await t.context.asyncOperationPgModel
    .search(t.context.knex, { id });
  t.is(dbRecords.length, 0);
});

test('del() does not remove from Elasticsearch if removing from PostgreSQL fails', async (t) => {
  const {
    originalPgRecord,
  } = await createAsyncOperationTestRecords(t.context);
  const { id } = originalPgRecord;

  const fakeAsyncOperationPgModel = {
    delete: () => {
      throw new Error('PG something bad');
    },
    get: () => Promise.resolve(originalPgRecord),
  };

  const expressRequest = {
    params: {
      id,
    },
    testContext: {
      knex: t.context.knex,
      asyncOperationPgModel: fakeAsyncOperationPgModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    del(expressRequest, response),
    { message: 'PG something bad' }
  );

  t.true(
    await t.context.asyncOperationPgModel.exists(t.context.knex, {
      id,
    })
  );
  t.true(
    await t.context.esAsyncOperationClient.exists(
      id
    )
  );
});
