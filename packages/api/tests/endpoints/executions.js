'use strict';

const test = require('ava');
const request = require('supertest');
const awsServices = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const {
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers
} = require('../../lib/testUtils');
const indexer = require('../../es/indexer');
const { Search } = require('../../es/search');
const { bootstrapElasticSearch } = require('../../lambdas/bootstrap');

const { AccessToken } = require('../../models');

const assertions = require('../../lib/assertions');

process.env.AccessTokensTable = randomString();
process.env.TOKEN_SECRET = randomString();
process.env.system_bucket = randomString();

const esIndex = randomString();
let esClient;

let jwtAuthToken;
let accessTokenModel;

// import the express app after setting the env variables
const { app } = require('../../app');

test.before(async () => {
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
    .map((execution) => indexer.indexExecution(esClient, execution, esAlias));

  await Promise.all(executionIndexPromises);

  await esClient.indices.refresh();
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await esClient.indices.delete({ index: esIndex });
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
