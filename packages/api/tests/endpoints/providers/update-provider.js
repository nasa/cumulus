'use strict';

const test = require('ava');
const sinon = require('sinon');
const { randomString } = require('@cumulus/common/test-utils');

const bootstrap = require('../../../lambdas/bootstrap');
const models = require('../../../models');
const providerEndpoint = require('../../../endpoints/providers');
const {
  createFakeJwtAuthToken,
  fakeProviderFactory,
  testEndpoint
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const assertions = require('../../../lib/assertions');

process.env.UsersTable = randomString();
process.env.ProvidersTable = randomString();
process.env.stackName = randomString();
process.env.internal = randomString();
process.env.TOKEN_SECRET = randomString();

let providerModel;
const esIndex = randomString();
let esClient;

let accessTokenModel;
let authHeaders;
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

  const jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });
  authHeaders = {
    Authorization: `Bearer ${jwtAuthToken}`
  };

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
  const request = {
    httpMethod: 'PUT',
    pathParameters: {
      id: 'asdf'
    },
    headers: {
      Authorization: 'Bearer invalid-token'
    }
  };

  return testEndpoint(providerEndpoint, request, (response) => {
    assertions.isInvalidAccessTokenResponse(t, response);
  });
});

test.todo('CUMULUS-912 PUT with pathParameters and with an unauthorized user returns an unauthorized response');

test('PUT updates an existing provider', (t) => {
  const updatedLimit = 2;

  const putEvent = {
    httpMethod: 'PUT',
    pathParameters: { id: t.context.testProvider.id },
    body: JSON.stringify({ globalConnectionLimit: updatedLimit }),
    headers: authHeaders
  };

  return testEndpoint(providerEndpoint, putEvent, (response) => {
    const { globalConnectionLimit } = JSON.parse(response.body);
    t.is(globalConnectionLimit, updatedLimit);
  });
});

test.serial('PUT updates an existing provider and returns it in listing', (t) => {
  const updateParams = {
    globalConnectionLimit: t.context.testProvider.globalConnectionLimit + 1
  };
  const updateEvent = {
    pathParameters: { id: t.context.testProvider.id },
    body: JSON.stringify(updateParams),
    httpMethod: 'PUT',
    headers: authHeaders
  };
  const updatedProvider = Object.assign(t.context.testProvider, updateParams);

  t.plan(2);
  return testEndpoint(providerEndpoint, updateEvent, () => {
    const listEvent = {
      httpMethod: 'GET',
      headers: authHeaders
    };

    const stub = sinon.stub(Search.prototype, 'query').resolves({
      results: [updatedProvider]
    });
    return testEndpoint(providerEndpoint, listEvent, (response) => {
      const { results } = JSON.parse(response.body);
      stub.restore();
      t.is(results.length, 1);
      t.deepEqual(results[0], updatedProvider);
    });
  });
});

test('PUT without an Authorization header returns an Authorization Missing response and does not update an existing provider', (t) => {
  const updatedLimit = t.context.testProvider.globalConnectionLimit + 1;
  const updateEvent = {
    pathParameters: { id: t.context.testProvider.id },
    body: JSON.stringify({ globalConnectionLimit: updatedLimit }),
    httpMethod: 'PUT',
    headers: {}
  };

  return testEndpoint(providerEndpoint, updateEvent, async (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
    const provider = await providerModel.get({
      id: t.context.testProvider.id
    });
    t.is(provider.globalConnectionLimit, t.context.testProvider.globalConnectionLimit);
  });
});
