'use strict';

const test = require('ava');
const fs = require('fs');
const path = require('path');
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

let jwtAuthToken;
let accessTokenModel;

// import the express app after setting the env variables
const { app } = require('../../app');

test.before(async (t) => {
  t.context.esIndex = randomString();

  const esAlias = randomString();
  process.env.ES_INDEX = esAlias;

  await bootstrapElasticSearch('fakehost', t.context.esIndex, esAlias);

  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  t.context.esClient = await Search.es('fakehost');

  // Index some fake logs
  const inputtxt = fs.readFileSync(path.join(__dirname, '../data/log_events_input.txt'), 'utf8');
  const event = JSON.parse(JSON.parse(inputtxt.toString()));
  await indexer.indexLog(t.context.esClient, event.logEvents, esAlias);

  await t.context.esClient.indices.refresh();
});

test.after.always(async (t) => {
  const { esClient, esIndex } = t.context;

  await accessTokenModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await esClient.indices.delete({ index: esIndex });
});

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/logs')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-911 GET with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/logs/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 GET without pathParameters and an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/logs/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 GET without pathParameters and an unauthorized user returns an unauthorized response');

test('GET logs returns all logs', async (t) => {
  const response = await request(app)
    .get('/logs')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.body.meta.count, 5);
});

test('GET logs with filter returns the correct logs', async (t) => {
  const response = await request(app)
    .get('/logs?level=error&limit=10')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.body.meta.count, 1);
});
