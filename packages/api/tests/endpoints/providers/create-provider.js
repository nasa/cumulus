'use strict';

const test = require('ava');
const request = require('supertest');
const { randomString } = require('@cumulus/common/test-utils');
const { RecordDoesNotExist } = require('@cumulus/common/errors');

const bootstrap = require('../../../lambdas/bootstrap');
const models = require('../../../models');
const {
  createFakeJwtAuthToken,
  fakeProviderFactory
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const assertions = require('../../../lib/assertions');

process.env.AccessTokensTable = randomString();
process.env.UsersTable = randomString();
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
let userModel;

const providerDoesNotExist = async (t, providerId) => {
  const error = await t.throws(providerModel.get({ id: providerId }));
  t.true(error instanceof RecordDoesNotExist);
};

test.before(async () => {
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);

  providerModel = new models.Provider();
  await providerModel.createTable();

  userModel = new models.User();
  await userModel.createTable();

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
  await providerModel.deleteTable();
  await accessTokenModel.deleteTable();
  await userModel.deleteTable();
  await esClient.indices.delete({ index: esIndex });
});

test('CUMULUS-911 POST without an Authorization header returns an Authorization Missing response', async (t) => {
  const newProvider = fakeProviderFactory();

  const response = await request(app)
    .post('/providers')
    .send(newProvider)
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
  await providerDoesNotExist(t, newProvider.id);
});

test('CUMULUS-912 POST with an invalid access token returns an unauthorized response', async (t) => {
  const newProvider = fakeProviderFactory();
  const response = await request(app)
    .post('/providers')
    .send(newProvider)
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
  await providerDoesNotExist(t, newProvider.id);
});

test.todo('CUMULUS-912 POST with an unauthorized user returns an unauthorized response');

test('POST with invalid authorization scheme returns an invalid authorization response', async (t) => {
  const newProvider = fakeProviderFactory();

  const response = await request(app)
    .post('/providers')
    .send(newProvider)
    .set('Accept', 'application/json')
    .set('Authorization', 'InvalidBearerScheme ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAuthorizationResponse(t, response);
  await providerDoesNotExist(t, newProvider.id);
});

test('POST creates a new provider', async (t) => {
  const newProviderId = 'AQUA';
  const newProvider = Object.assign({}, t.context.testProvider, { id: newProviderId });

  const response = await request(app)
    .post('/providers')
    .send(newProvider)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { message, record } = response.body;
  t.is(message, 'Record saved');
  t.is(record.id, newProviderId);
});
