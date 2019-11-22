'use strict';

const test = require('ava');
const request = require('supertest');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const {
  createFakeJwtAuthToken
} = require('../../lib/testUtils');
const indexer = require('../../es/indexer');
const { Search } = require('../../es/search');
const { bootstrapElasticSearch } = require('../../lambdas/bootstrap');
const { deleteAliases } = require('../../lib/testUtils');

const { AccessToken, User } = require('../../models');

const assertions = require('../../lib/assertions');

process.env.AccessTokensTable = randomString();
process.env.UsersTable = randomString();
process.env.TOKEN_SECRET = randomString();
process.env.system_bucket = randomString();

const esIndex = randomString();
process.env.ES_INDEX = esIndex;
let esClient;


let jwtAuthToken;
let accessTokenModel;
let userModel;


// import the express app after setting the env variables
const { app } = require('../../app');

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await userModel.deleteTable();
  await aws.recursivelyDeleteS3Bucket(process.env.system_bucket);
  await esClient.indices.delete({ index: esIndex });
});

test.before(async () => {
  await deleteAliases();

  await bootstrapElasticSearch('fakehost', esIndex);
  process.env.esIndex = esIndex;
  await aws.s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  // create fake Users table
  userModel = new User();
  await userModel.createTable();

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });

  esClient = await Search.es('fakehost');

  const executions = [
    {
      arn: 'arn1',
      status: 'running'
    },
    {
      arn: 'arn2',
      status: 'completed',
      asyncOperationId: '012345-12345'
    }
  ];

  const executionIndexPromises = executions
    .map((execution) => indexer.indexExecution(esClient, execution));

  await Promise.all(executionIndexPromises);

  await esClient.indices.refresh();
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
    .expect(403);

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
    .get('/executions?asyncOperationId=012345-12345')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.body.meta.count, 1);
  t.is(response.body.results[0].arn, 'arn2');
});
