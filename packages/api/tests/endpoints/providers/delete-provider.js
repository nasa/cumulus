'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');

const bootstrap = require('../../../lambdas/bootstrap');
const models = require('../../../models');
const providerEndpoint = require('../../../endpoints/providers');
const {
  fakeUserFactory,
  fakeProviderFactory,
  testEndpoint
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const assertions = require('../../../lib/assertions');

process.env.UsersTable = randomString();
process.env.ProvidersTable = randomString();
process.env.stackName = randomString();
process.env.internal = randomString();
let providerModel;
const esIndex = randomString();
let esClient;

let authHeaders;
let userModel;

test.before(async () => {
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);

  providerModel = new models.Provider();
  await providerModel.createTable();

  userModel = new models.User();
  await userModel.createTable();

  const authToken = (await userModel.create(fakeUserFactory())).password;
  authHeaders = {
    Authorization: `Bearer ${authToken}`
  };

  esClient = await Search.es('fakehost');
});

test.beforeEach(async (t) => {
  t.context.testProvider = fakeProviderFactory();
  await providerModel.create(t.context.testProvider);
});

test.after.always(async () => {
  await providerModel.deleteTable();
  await userModel.deleteTable();
  await esClient.indices.delete({ index: esIndex });
});

test('Attempting to delete a provider without an Authorization header returns an Authorization Missing response', (t) => {
  const { testProvider } = t.context;

  const request = {
    httpMethod: 'DELETE',
    pathParameters: { id: testProvider.id },
    headers: {}
  };

  return testEndpoint(providerEndpoint, request, async (response) => {
    t.is(response.statusCode, 401);
    t.true(await providerModel.exists(testProvider.id));
  });
});

test('Attempting to delete a provider with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'DELETE',
    pathParameters: {
      id: 'asdf'
    },
    headers: {
      Authorization: 'Bearer invalid-token'
    }
  };

  return testEndpoint(providerEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('Deleting a provider removes the provider', (t) => {
  const { testProvider } = t.context;

  const deleteRequest = {
    httpMethod: 'DELETE',
    pathParameters: { id: testProvider.id },
    headers: authHeaders
  };

  return testEndpoint(providerEndpoint, deleteRequest, async () => {
    t.false(await providerModel.exists(testProvider.id));
  });
});
