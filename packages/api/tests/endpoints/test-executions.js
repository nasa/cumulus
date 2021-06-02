'use strict';

const test = require('ava');
const request = require('supertest');
const cryptoRandomString = require('crypto-random-string');

const awsServices = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const {
  AsyncOperationPgModel,
  CollectionPgModel,
  generateLocalTestDb,
  destroyLocalTestDb,
  ExecutionPgModel,
  localStackConnectionEnv,
  fakeExecutionRecordFactory,
  fakeAsyncOperationRecordFactory,
  fakeCollectionRecordFactory,
} = require('@cumulus/db');

const models = require('../../models');
const bootstrap = require('../../lambdas/bootstrap');
const indexer = require('../../es/indexer');
const {
  createFakeJwtAuthToken,
  fakeExecutionFactory,
  setAuthorizedOAuthUsers,
} = require('../../lib/testUtils');
const { Search } = require('../../es/search');
const assertions = require('../../lib/assertions');
const { migrationDir } = require('../../../../lambdas/db-migration');

// create all the variables needed across this test
let esClient;
let esIndex;
const fakeExecutions = [];
process.env.AccessTokensTable = randomString();
process.env.ExecutionsTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

const testDbName = `test_executions_${cryptoRandomString({ length: 10 })}`;

let jwtAuthToken;
let accessTokenModel;
let executionModel;

test.before(async (t) => {
  esIndex = randomString();
  // create esClient
  esClient = await Search.es('fakehost');

  const esAlias = randomString();
  process.env.ES_INDEX = esAlias;

  // add fake elasticsearch index
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex, esAlias);

  // create a fake bucket
  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  // create fake execution table
  executionModel = new models.Execution();
  await executionModel.createTable();

  // create fake execution records
  fakeExecutions.push(fakeExecutionFactory('completed'));
  fakeExecutions.push(fakeExecutionFactory('failed', 'workflow2'));
  // TODO - this needs updated after postgres->ES work
  await Promise.all(fakeExecutions.map((i) => executionModel.create(i)
    .then((record) => indexer.indexExecution(esClient, record, esAlias))));

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };
  // eslint-disable-next-line global-require
  const { app } = require('../../app');
  t.context.app = app;
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
  await executionModel.deleteTable();
  await esClient.indices.delete({ index: esIndex });
  await recursivelyDeleteS3Bucket(process.env.system_bucket);

  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(t.context.app)
    .get('/executions')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-911 GET with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(t.context.app)
    .get('/executions/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 GET without pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const response = await request(t.context.app)
    .get('/executions')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 GET with pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const response = await request(t.context.app)
    .get('/executions/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('default returns list of executions', async (t) => {
  const response = await request(t.context.app)
    .get('/executions')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { meta, results } = response.body;
  t.is(results.length, 2);
  t.is(meta.stack, process.env.stackName);
  t.is(meta.table, 'execution');
  t.is(meta.count, 2);
  const arns = fakeExecutions.map((i) => i.arn);
  results.forEach((r) => {
    t.true(arns.includes(r.arn));
  });
});

test('executions can be filtered by workflow', async (t) => {
  const response = await request(t.context.app)
    .get('/executions')
    .query({ type: 'workflow2' })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { meta, results } = response.body;
  t.is(results.length, 1);
  t.is(meta.stack, process.env.stackName);
  t.is(meta.table, 'execution');
  t.is(meta.count, 1);
  t.is(fakeExecutions[1].arn, results[0].arn);
});

test.only('GET returns an existing execution', async (t) => {
  const collectionRecord = fakeCollectionRecordFactory();
  const asyncRecord = fakeAsyncOperationRecordFactory();
  const parentExecutionRecord = fakeExecutionRecordFactory();

  const executionPgModel = new ExecutionPgModel();
  const collectionPgModel = new CollectionPgModel();
  const asyncOperationsPgModel = new AsyncOperationPgModel();

  const [collectionCumulusId] = await collectionPgModel.create(
    t.context.knex,
    collectionRecord
  );

  const [asyncOperationCumulusId] = await asyncOperationsPgModel.create(
    t.context.knex,
    asyncRecord
  );

  const [parentExecutionCumulusId] = await executionPgModel.create(
    t.context.knex,
    parentExecutionRecord
  );

  const executionRecord = await fakeExecutionRecordFactory({
    async_operation_cumulus_id: asyncOperationCumulusId,
    collection_cumulus_id: collectionCumulusId,
    parent_cumulus_id: parentExecutionCumulusId,
  });

  const createResult = await executionPgModel.create(
    t.context.knex,
    executionRecord
  );
  t.teardown(async () => await executionPgModel.delete(t.context.knex, executionRecord));

  console.log(`Create result is ${createResult}`);
  console.log(`Create value is ${JSON.stringify(executionRecord)}`);
  const response = await request(t.context.app)
    .get(`/executions/${executionRecord.arn}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const executionResult = response.body;
  const expectedRecord = {
    ...executionRecord,
    created_at: executionRecord.created_at.toISOString(),
    timestamp: executionRecord.timestamp.toISOString(),
    updated_at: executionRecord.updated_at.toISOString(),
  };

  t.is(executionResult.arn, executionRecord.arn);
  t.is(executionResult.asyncOperationId, asyncRecord.id);
  t.is(executionResult.collectionId, `${collectionRecord.name}___${collectionRecord.version}`);
  t.is(executionResult.parentArn, parentExecutionRecord.arn);

  t.like(executionResult, expectedRecord);
});

test.serial('GET fails if execution is not found', async (t) => {
  const response = await request(t.context.app)
    .get('/executions/unknown')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);

  t.is(response.status, 404);
  t.true(response.body.message.includes('No record found for'));
});
