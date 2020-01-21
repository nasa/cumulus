'use strict';

const test = require('ava');
const request = require('supertest');
const { s3 } = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');

const bootstrap = require('../../../lambdas/bootstrap');
const models = require('../../../models');
const {
  createFakeJwtAuthToken,
  fakeProviderFactory,
  setAuthorizedOAuthUsers
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const indexer = require('../../../es/indexer');
const assertions = require('../../../lib/assertions');

process.env.AccessTokensTable = randomString();
process.env.ProvidersTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../../app');

let providerModel;
const esIndex = randomString();
let esClient;

let jwtAuthToken;
let accessTokenModel;

test.before(async () => {
  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  accessTokenModel = new models.AccessToken();
  providerModel = new models.Provider();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  const esAlias = randomString();
  process.env.ES_INDEX = esAlias;

  await Promise.all([
    accessTokenModel.createTable(),
    bootstrap.bootstrapElasticSearch('fakehost', esIndex, esAlias),
    providerModel.createTable()
  ]);

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  esClient = await Search.es('fakehost');
});

test.after.always(() => Promise.all([
  recursivelyDeleteS3Bucket(process.env.system_bucket),
  accessTokenModel.deleteTable(),
  esClient.indices.delete({ index: esIndex }),
  providerModel.deleteTable()
]));

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/providers')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 GET without pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/providers')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 GET without pathParameters and with an unauthorized user returns an unauthorized response');

test('default returns list of providerModel', async (t) => {
  const testProvider = fakeProviderFactory();
  const record = await providerModel.create(testProvider);
  await indexer.indexProvider(esClient, record, esIndex);

  const response = await request(app)
    .get('/providers')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results } = response.body;
  t.truthy(results.find((r) => r.id === testProvider.id));
});
