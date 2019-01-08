'use strict';

const test = require('ava');
const request = require('supertest');
const sinon = require('sinon');
const { randomString } = require('@cumulus/common/test-utils');

const bootstrap = require('../../../lambdas/bootstrap');
const models = require('../../../models');
const {
  createFakeJwtAuthToken,
  fakeProviderFactory
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const assertions = require('../../../lib/assertions');

process.env.UsersTable = randomString();
process.env.ProvidersTable = randomString();
process.env.stackName = randomString();
process.env.internal = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../../app');

let providerModel;
const esIndex = randomString();
let esClient;

let accessTokenModel;
let jwtAuthToken;
let userModel;

test.before(async () => {
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);

  providerModel = new models.Provider();
  await providerModel.createTable();

  userModel = new models.User();
  await userModel.createTable();

  process.env.AccessTokensTable = randomString();
  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });
  esClient = await Search.es('fakehost');
});

test.beforeEach(async (t) => {
  t.context.testProvider = fakeProviderFactory();
  await providerModel.create(t.context.testProvider);
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await providerModel.deleteTable();
  await userModel.deleteTable();
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

test('PUT updates an existing provider', async (t) => {
  const updatedLimit = 2;

  const response = await request(app)
    .put(`/providers/${t.context.testProvider.id}`)
    .send({ globalConnectionLimit: updatedLimit })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { globalConnectionLimit } = response.body;
  t.is(globalConnectionLimit, updatedLimit);
});

test.serial('PUT updates an existing provider and returns it in listing', async (t) => {
  const updateParams = {
    globalConnectionLimit: t.context.testProvider.globalConnectionLimit + 1
  };
  const updatedProvider = Object.assign(t.context.testProvider, updateParams);

  await request(app)
    .put(`/providers/${t.context.testProvider.id}`)
    .send(updateParams)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.plan(2);
  const stub = sinon.stub(Search.prototype, 'query').resolves({
    results: [updatedProvider]
  });

  const response = await request(app)
    .get('/providers')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results } = response.body;
  stub.restore();
  t.is(results.length, 1);
  t.deepEqual(results[0], updatedProvider);
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
