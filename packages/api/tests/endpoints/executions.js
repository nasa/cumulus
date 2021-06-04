'use strict';

const test = require('ava');
const request = require('supertest');
const awsServices = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const {
  destroyLocalTestDb,
  ExecutionPgModel,
  generateLocalTestDb,
  localStackConnectionEnv,
  translateApiExecutionToPostgresExecution,
} = require('@cumulus/db');
const { bootstrapElasticSearch } = require('@cumulus/es-client/bootstrap');
const indexer = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
const {
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers,
} = require('../../lib/testUtils');
const { migrationDir } = require('../../../../lambdas/db-migration');

const { AccessToken, Execution } = require('../../models');

const assertions = require('../../lib/assertions');

process.env.AccessTokensTable = randomString();
process.env.TOKEN_SECRET = randomString();
process.env.system_bucket = randomString();
process.env.stackName = randomString();
process.env.ExecutionsTable = randomString();

const esIndex = randomString();
let esClient;

let jwtAuthToken;
let accessTokenModel;

const testDbName = randomId('execution_test');

// import the express app after setting the env variables
const { app } = require('../../app');

test.before(async (t) => {
  const esAlias = randomString();
  process.env.ES_INDEX = esAlias;
  await bootstrapElasticSearch('fakehost', esIndex, esAlias);

  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  esClient = await Search.es('fakehost');

  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;

  t.context.executions = [
    {
      arn: 'arn1',
      status: 'running',
      name: 'test_execution',
    },
    {
      arn: 'arn2',
      status: 'completed',
      asyncOperationId: '0fe6317a-233c-4f19-a551-f0f76071402f',
      name: 'test_execution',
    },
  ];

  const executionIndexPromises = t.context.executions
    .map((execution) => indexer.indexExecution(esClient, execution, esAlias));

  await Promise.all(executionIndexPromises);

  await esClient.indices.refresh();

  t.context.executionDynamoModel = new Execution();
  await t.context.executionDynamoModel.createTable();

  t.context.executionPgModel = new ExecutionPgModel();
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await esClient.indices.delete({ index: esIndex });

  await destroyLocalTestDb({
    knex: t.context.testKnex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
});

test('GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/executions')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('GET with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/executions/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('GET without pathParameters and an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/logs/executions')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test('GET logs returns all executions', async (t) => {
  const response = await request(app)
    .get('/executions')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.body.meta.count, 2);
});

test('GET executions with asyncOperationId filter returns the correct executions', async (t) => {
  const response = await request(app)
    .get('/executions?asyncOperationId=0fe6317a-233c-4f19-a551-f0f76071402f')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.body.meta.count, 1);
  t.is(response.body.results[0].arn, 'arn2');
});

test('DELETE removes only specified execution from all data stores', async (t) => {
  const {
    executionDynamoModel,
    executionPgModel,
    testKnex,
    executions,
  } = t.context;

  const newExecution = {
    arn: 'arn3',
    status: 'completed',
    name: 'test_execution',
  };

  executions.push(newExecution);

  await Promise.all(executions.map(async (execution) => {
    // delete async operation foreign key to avoid needing a valid async operation
    delete execution.asyncOperationId;
    await executionDynamoModel.create(execution);
    const executionPgRecord = await translateApiExecutionToPostgresExecution(execution, testKnex);
    await executionPgModel.create(testKnex, executionPgRecord);
  }));

  t.true(await executionDynamoModel.exists({ arn: newExecution.arn }));
  t.true(
    await executionPgModel.exists(testKnex, { arn: newExecution.arn })
  );

  await request(app)
    .delete(`/executions/${newExecution.arn}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  // Correct Dynamo and PG execution was deleted
  t.false(await executionDynamoModel.exists({ arn: newExecution.arn }));

  const dbRecords = await executionPgModel
    .search(t.context.testKnex, { arn: newExecution.arn });

  t.is(dbRecords.length, 0);

  // Previously created executions still exist
  t.true(await executionDynamoModel.exists({ arn: executions[0].arn }));
  t.true(await executionDynamoModel.exists({ arn: executions[1].arn }));

  const originalExecution1 = await executionPgModel
    .search(t.context.testKnex, { arn: executions[0].arn });

  t.is(originalExecution1.length, 1);

  const originalExecution2 = await executionPgModel
    .search(t.context.testKnex, { arn: executions[1].arn });

  t.is(originalExecution2.length, 1);
});

test('DELETE returns a 404 if Dynamo execution cannot be found', async (t) => {
  const nonExistantExecution = {
    arn: 'arn9',
    status: 'completed',
    name: 'test_execution',
  };

  const response = await request(app)
    .delete(`/executions/${nonExistantExecution.arn}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);

  t.is(response.body.message, 'No record found');
});
