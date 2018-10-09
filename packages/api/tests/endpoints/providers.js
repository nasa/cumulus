'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');

const bootstrap = require('../../lambdas/bootstrap');
const models = require('../../models');
const providerEndpoint = require('../../endpoints/providers');
const {
  fakeUserFactory,
  testEndpoint
} = require('../../lib/testUtils');
const { Search } = require('../../es/search');
const { indexProvider } = require('../../es/indexer');
const assertions = require('../../lib/assertions');

process.env.UsersTable = randomString();
process.env.ProvidersTable = randomString();
process.env.stackName = randomString();
process.env.internal = randomString();
let providers;
const esIndex = randomString();
let esClient;

const testProvider = {
  id: 'orbiting-carbon-observatory-2',
  globalConnectionLimit: 1,
  protocol: 'http',
  host: 'https://oco.jpl.nasa.gov/',
  port: 80
};

let authHeaders;
let userModel;
test.before(async () => {
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);

  providers = new models.Provider();
  await providers.createTable();

  await providers.create(testProvider);

  userModel = new models.User();
  await userModel.createTable();

  const authToken = (await userModel.create(fakeUserFactory())).password;
  authHeaders = {
    Authorization: `Bearer ${authToken}`
  };

  esClient = await Search.es('fakehost');
});

test.after.always(async () => {
  await providers.deleteTable();
  await userModel.deleteTable();
  await esClient.indices.delete({ index: esIndex });
});

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {}
  };

  return testEndpoint(providerEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 GET with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      id: 'asdf'
    },
    headers: {}
  };

  return testEndpoint(providerEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 POST without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'POST',
    headers: {}
  };

  return testEndpoint(providerEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 PUT with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'PUT',
    pathParameters: {
      id: 'asdf'
    },
    headers: {}
  };

  return testEndpoint(providerEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 DELETE with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'DELETE',
    pathParameters: {
      id: 'asdf'
    },
    headers: {}
  };

  return testEndpoint(providerEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-912 GET without pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {
      Authorization: 'Bearer invalid-token'
    }
  };

  return testEndpoint(providerEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('CUMULUS-912 GET with pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'GET',
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

test('CUMULUS-912 POST with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'POST',
    headers: {
      Authorization: 'Bearer invalid-token'
    }
  };

  return testEndpoint(providerEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('CUMULUS-912 PUT with pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
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
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('CUMULUS-912 DELETE with pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
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

test('default returns list of providers', async (t) => {
  const newProviderId = randomString();
  const newProvider = Object.assign({}, testProvider, { id: newProviderId });

  await indexProvider(esClient, newProvider, esIndex);

  const listEvent = {
    httpMethod: 'list',
    headers: authHeaders
  };

  return testEndpoint(providerEndpoint, listEvent, (response) => {
    const responseBody = JSON.parse(response.body);
    t.is(responseBody.results[0].id, newProviderId);
  });
});

test('POST creates a new provider', (t) => {
  const newProviderId = 'AQUA';
  const newProvider = Object.assign({}, testProvider, { id: newProviderId });

  const postEvent = {
    httpMethod: 'POST',
    body: JSON.stringify(newProvider),
    headers: authHeaders
  };

  return testEndpoint(providerEndpoint, postEvent, (response) => {
    const { message, record } = JSON.parse(response.body);
    t.is(message, 'Record saved');
    t.is(record.id, newProviderId);
  });
});

test.serial('GET returns an existing provider', (t) => {
  const getEvent = {
    httpMethod: 'GET',
    pathParameters: { id: testProvider.id },
    headers: authHeaders
  };

  return testEndpoint(providerEndpoint, getEvent, (response) => {
    t.is(JSON.parse(response.body).id, testProvider.id);
  });
});

test.serial('PUT updates an existing provider', (t) => {
  const updatedLimit = 2;

  const putEvent = {
    httpMethod: 'PUT',
    pathParameters: { id: testProvider.id },
    body: JSON.stringify({ globalConnectionLimit: updatedLimit }),
    headers: authHeaders
  };

  return testEndpoint(providerEndpoint, putEvent, (response) => {
    const { globalConnectionLimit } = JSON.parse(response.body);
    t.is(globalConnectionLimit, updatedLimit);
  });
});

test.serial('DELETE deletes an existing provider', (t) => {
  const deleteEvent = {
    httpMethod: 'DELETE',
    pathParameters: { id: testProvider.id },
    headers: authHeaders
  };
  return testEndpoint(providerEndpoint, deleteEvent, (response) => {
    const { message } = JSON.parse(response.body);
    t.is(message, 'Record deleted');
  });
});
