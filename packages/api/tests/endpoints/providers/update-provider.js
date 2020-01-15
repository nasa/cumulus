'use strict';

const omit = require('lodash.omit');
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
const assertions = require('../../../lib/assertions');

process.env.ProvidersTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../../app');

let providerModel;
const esIndex = randomString();
let esClient;

let accessTokenModel;
let jwtAuthToken;

test.before(async () => {
  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  const esAlias = randomString();
  process.env.ES_INDEX = esAlias;
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex, esAlias);

  providerModel = new models.Provider();
  await providerModel.createTable();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  process.env.AccessTokensTable = randomString();
  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
  esClient = await Search.es('fakehost');
});

test.beforeEach(async (t) => {
  t.context.testProvider = {
    ...fakeProviderFactory(),
    cmKeyId: 'key'
  };
  await providerModel.create(t.context.testProvider);
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await accessTokenModel.deleteTable();
  await providerModel.deleteTable();
  await esClient.indices.delete({ index: esIndex });
});

test('CUMULUS-912 PUT with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .put('/providers/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 PUT with pathParameters and with an unauthorized user returns an unauthorized response');

test('PUT replaces existing provider', async (t) => {
  const { testProvider, testProvider: { id } } = t.context;
  const expectedProvider = omit(testProvider,
    ['globalConnectionLimit', 'protocol', 'cmKeyId']);

  // Make sure testProvider contains values for the properties we omitted from
  // expectedProvider to confirm that after we replace (PUT) the provider those
  // properties are dropped from the stored provider.
  t.truthy(testProvider.globalConnectionLimit);
  t.truthy(testProvider.protocol);
  t.truthy(testProvider.cmKeyId);

  await request(app)
    .put(`/providers/${id}`)
    .send(expectedProvider)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { body: actualProvider } = await request(app)
    .get(`/providers/${id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.deepEqual(actualProvider, {
    ...expectedProvider,
    globalConnectionLimit: 10, // Default value
    protocol: 'http', // Default value
    createdAt: actualProvider.createdAt,
    updatedAt: actualProvider.updatedAt
  });
});

test('PUT returns 404 for non-existent provider', async (t) => {
  const id = randomString();
  const response = await request(app)
    .put(`/provider/${id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ id })
    .expect(404);
  const { message, record } = response.body;

  t.truthy(message);
  t.falsy(record);
});

test('PUT returns 400 for id mismatch between params and payload',
  async (t) => {
    const response = await request(app)
      .put(`/providers/${randomString()}`)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send({ id: randomString() })
      .expect(400);
    const { message, record } = response.body;

    t.truthy(message);
    t.falsy(record);
  });

test('PUT without an Authorization header returns an Authorization Missing response and does not update an existing provider', async (t) => {
  const updatedLimit = t.context.testProvider.globalConnectionLimit + 1;
  const response = await request(app)
    .put(`/providers/${t.context.testProvider.id}`)
    .send({ globalConnectionLimit: updatedLimit })
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
  const provider = await providerModel.get({
    id: t.context.testProvider.id
  });
  t.is(provider.globalConnectionLimit, t.context.testProvider.globalConnectionLimit);
});
