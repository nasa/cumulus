'use strict';

const test = require('ava');
const request = require('supertest');
const noop = require('lodash/noop');
const omit = require('lodash/omit');
const sinon = require('sinon');

const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const {
  localStackConnectionEnv,
  generateLocalTestDb,
  destroyLocalTestDb,
  AsyncOperationPgModel,
  translateApiAsyncOperationToPostgresAsyncOperation,
  translatePostgresAsyncOperationToApiAsyncOperation,
  migrationDir,
} = require('@cumulus/db');

const assertions = require('../../../lib/assertions');
const { fakeAsyncOperationFactory } = require('../../../lib/testUtils');
const {
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers,
} = require('../../../lib/testUtils');
const {
  AccessToken,
} = require('../../../models');

process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.AccessTokensTable = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../../app');

const testDbName = randomId('async_operations_test');

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;
  t.context.asyncOperationPgModel = new AsyncOperationPgModel();

  await s3().createBucket({ Bucket: process.env.system_bucket });

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  t.context.accessTokenModel = new AccessToken();
  await t.context.accessTokenModel.createTable();

  t.context.jwtAuthToken = await createFakeJwtAuthToken({
    accessTokenModel: t.context.accessTokenModel,
    username,
  });
});

test.after.always(async (t) => {
  await t.context.accessTokenModel.deleteTable().catch(noop);
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await destroyLocalTestDb({
    knex: t.context.testKnex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
});

test('POST without an Authorization header returns an Authorization Missing response', async (t) => {
  const asyncOperation1 = fakeAsyncOperationFactory();

  const response = await request(app)
    .post('/asyncOperations')
    .send(asyncOperation1)
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('POST with an invalid access token returns an unauthorized response', async (t) => {
  const asyncOperation = fakeAsyncOperationFactory();

  const response = await request(app)
    .post('/asyncOperations')
    .send(asyncOperation)
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test('POST creates and stores expected new async operation record', async (t) => {
  const { asyncOperationPgModel, jwtAuthToken } = t.context;
  const asyncOperation = fakeAsyncOperationFactory({
    output: JSON.stringify({ age: 59 }),
  });

  const pgAsyncOperation = await translateApiAsyncOperationToPostgresAsyncOperation(asyncOperation);

  const omitList = ['created_at', 'updated_at', 'cumulus_id', 'output'];

  const response = await request(app)
    .post('/asyncOperations')
    .send(asyncOperation)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { message, record } = response.body;
  const pgRecord = await asyncOperationPgModel.search(
    t.context.testKnex,
    { id: asyncOperation.id }
  );

  t.is(message, 'Record saved');
  t.is(record.id, asyncOperation.id);
  t.is(pgRecord.length, 1);

  const [asyncOperationPgRecord] = pgRecord;

  t.deepEqual(
    omit(asyncOperationPgRecord, omitList),
    omit(pgAsyncOperation, omitList)
  );
  t.deepEqual(asyncOperationPgRecord.output, pgAsyncOperation.output);
});

test('POST creates a new async operation record with correct timestamps', async (t) => {
  const { asyncOperationPgModel, jwtAuthToken } = t.context;
  const asyncOperation = fakeAsyncOperationFactory({
    output: JSON.stringify({ age: 59 }),
  });

  const response = await request(app)
    .post('/asyncOperations')
    .send(asyncOperation)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);
  const { record } = response.body;

  const pgRecord = await asyncOperationPgModel.search(
    t.context.testKnex,
    { id: asyncOperation.id }
  );

  const [asyncOperationPgRecord] = pgRecord;

  const apiRecord = translatePostgresAsyncOperationToApiAsyncOperation(asyncOperationPgRecord);

  t.true(apiRecord.createdAt > asyncOperation.createdAt);
  t.true(apiRecord.updatedAt > asyncOperation.updatedAt);

  t.is(asyncOperationPgRecord.created_at.getTime(), record.createdAt);
  t.is(asyncOperationPgRecord.updated_at.getTime(), record.updatedAt);
});

test('POST returns a 409 error if the async operation already exists in PostgreSQL', async (t) => {
  const { asyncOperationPgModel, jwtAuthToken, testKnex } = t.context;
  const asyncOperation = fakeAsyncOperationFactory();
  const pgAsyncOperation = translateApiAsyncOperationToPostgresAsyncOperation(asyncOperation);

  await asyncOperationPgModel.create(testKnex, pgAsyncOperation);

  const response = await request(app)
    .post('/asyncOperations')
    .send(asyncOperation)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(409);
  const { message } = response.body;
  t.is(message, (`A record already exists for async operation ID ${asyncOperation.id}`));
});

test.serial('POST returns a 500 response if record creation throws unexpected error', async (t) => {
  const { jwtAuthToken } = t.context;
  const stub = sinon.stub(AsyncOperationPgModel.prototype, 'create')
    .callsFake(() => {
      throw new Error('unexpected error');
    });

  const asyncOperation = fakeAsyncOperationFactory();

  const response = await request(app)
    .post('/asyncOperations')
    .send(asyncOperation)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(500);

  t.is(response.status, 500);
  t.teardown(() => {
    stub.restore();
  });
});

test('POST returns a 400 response if invalid record is provided', async (t) => {
  const { jwtAuthToken } = t.context;
  const asyncOperation = { invalid: 'value' };

  const response = await request(app)
    .post('/asyncOperations')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(asyncOperation)
    .expect(400);
  t.is(response.status, 400);
});

test('POST returns a 404 if the requested path does not exist', async (t) => {
  const { jwtAuthToken } = t.context;

  const response = await request(app)
    .post(`/asyncOperations/${randomString()}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);

  t.is(response.statusCode, 404);
});

test('POST returns a 400 response if invalid JSON provided', async (t) => {
  const { jwtAuthToken } = t.context;
  const response = await request(app)
    .post('/asyncOperations')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send('asdf');

  const error = JSON.parse(response.error.text);

  t.is(response.statusCode, 400);
  t.is(error.error, 'Bad Request');
  t.is(error.message, 'Async Operations require an ID');
});
