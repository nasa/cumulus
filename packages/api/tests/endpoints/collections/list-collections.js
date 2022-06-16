'use strict';

const test = require('ava');
const request = require('supertest');
const sinon = require('sinon');
const awsServices = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const { bootstrapElasticSearch } = require('@cumulus/es-client/bootstrap');
const EsCollection = require('@cumulus/es-client/collections');
const { Search } = require('@cumulus/es-client/search');

const models = require('../../../models');
const {
  createFakeJwtAuthToken,
  fakeCollectionFactory,
  setAuthorizedOAuthUsers,
} = require('../../../lib/testUtils');
const assertions = require('../../../lib/assertions');

process.env.AccessTokensTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../../app');

const esIndex = randomString();
let esClient;

let jwtAuthToken;
let accessTokenModel;

test.before(async () => {
  const esAlias = randomString();
  process.env.ES_INDEX = esAlias;
  await bootstrapElasticSearch({
    host: 'fakehost',
    index: esIndex,
    alias: esAlias,
  });
  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket });

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
  esClient = await Search.es('fakehost');
});

test.beforeEach((t) => {
  t.context.testCollection = fakeCollectionFactory();
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await esClient.indices.delete({ index: esIndex });
});

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/collections')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 GET without pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/collections')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 GET without pathParameters and with an unauthorized user returns an unauthorized response');

test.serial('default returns list of collections from query', async (t) => {
  const stub = sinon.stub(EsCollection.prototype, 'query').returns({ results: [t.context.testCollection] });
  const spy = sinon.stub(EsCollection.prototype, 'addStatsToCollectionResults');

  const response = await request(app)
    .get('/collections')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results } = response.body;
  t.is(results.length, 1);
  t.is(results[0].name, t.context.testCollection.name);
  t.true(spy.notCalled);
  stub.restore();
  spy.restore();
});

test.serial('returns list of collections with stats when requested', async (t) => {
  const stub = sinon.stub(EsCollection.prototype, 'getStats').returns([t.context.testCollection]);

  const response = await request(app)
    .get('/collections?includeStats=true')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results } = response.body;
  t.is(results.length, 1);
  t.is(results[0].name, t.context.testCollection.name);
  stub.restore();
});
