'use strict';

const test = require('ava');
const request = require('supertest');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const models = require('../../../models');
const bootstrap = require('../../../lambdas/bootstrap');
const indexer = require('../../../es/indexer');
const {
  createFakeJwtAuthToken,
  fakeExecutionFactory
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const assertions = require('../../../lib/assertions');

// create all the variables needed across this test
let esClient;
let esIndex;
const fakeExecutions = [];
process.env.AccessTokensTable = randomString();
process.env.ExecutionsTable = randomString();
process.env.UsersTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../../app');

let jwtAuthToken;
let accessTokenModel;
let executionModel;
let userModel;

test.before(async () => {
  esIndex = randomString();
  // create esClient
  esClient = await Search.es('fakehost');

  // add fake elasticsearch index
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);

  // create a fake bucket
  await aws.s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  // create fake granule table
  executionModel = new models.Execution();
  await executionModel.createTable();

  // create fake granule records
  fakeExecutions.push(fakeExecutionFactory('completed'));
  fakeExecutions.push(fakeExecutionFactory('failed', 'workflow2'));
  await Promise.all(fakeExecutions.map((i) => executionModel.create(i)
    .then((record) => indexer.indexExecution(esClient, record, esIndex))));

  userModel = new models.User();
  await userModel.createTable();

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await executionModel.deleteTable();
  await userModel.deleteTable();
  await esClient.indices.delete({ index: esIndex });
  await aws.recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/executions')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-911 GET with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/executions/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 GET without pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/executions')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 GET with pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/executions/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('default returns list of executions', async (t) => {
  const response = await request(app)
    .get('/executions')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { meta, results } = response.body;
  t.is(results.length, 2);
  t.is(meta.stack, process.env.stackName);
  t.is(meta.table, process.env.ExecutionsTable);
  t.is(meta.count, 2);
  const arns = fakeExecutions.map((i) => i.arn);
  results.forEach((r) => {
    t.true(arns.includes(r.arn));
  });
});

test('executions can be filtered by workflow', async (t) => {
  const response = await request(app)
    .get('/executions')
    .query({ type: 'workflow2' })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { meta, results } = response.body;
  t.is(results.length, 1);
  t.is(meta.stack, process.env.stackName);
  t.is(meta.table, process.env.ExecutionsTable);
  t.is(meta.count, 1);
  t.is(fakeExecutions[1].arn, results[0].arn);
});

test('GET returns an existing execution', async (t) => {
  const response = await request(app)
    .get(`/executions/${fakeExecutions[0].arn}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const executionResult = response.body;
  t.is(executionResult.arn, fakeExecutions[0].arn);
  t.is(executionResult.name, fakeExecutions[0].name);
  t.truthy(executionResult.duration);
  t.is(executionResult.status, 'completed');
});

test('GET fails if execution is not found', async (t) => {
  const response = await request(app)
    .get('/executions/unknown')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);

  t.is(response.status, 404);
  t.true(response.body.message.includes('No record found for'));
});
