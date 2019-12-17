'use strict';

const test = require('ava');
const fs = require('fs');
const path = require('path');
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

  // Index some fake logs
  const inputtxt = fs.readFileSync(path.join(__dirname, '../data/log_events_input.txt'), 'utf8');
  const event = JSON.parse(JSON.parse(inputtxt.toString()));
  await indexer.indexLog(esClient, event.logEvents);

  await esClient.indices.refresh();
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

// Disabled until CUMULUS-1674 is fixed
test.skip('GET logs returns all logs', async (t) => {
  const response = await request(app)
    .get('/logs')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.body.meta.count, 5);
});

// Disabled until CUMULUS-1674 is fixed
test.skip('GET logs with filter returns the correct logs', async (t) => {
  const response = await request(app)
    .get('/logs?level=error&limit=10')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.body.meta.count, 1);
});
