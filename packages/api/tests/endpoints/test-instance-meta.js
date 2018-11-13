'use strict';

const test = require('ava');

const { randomString } = require('@cumulus/common/test-utils');
const assertions = require('../../lib/assertions');
const models = require('../../models');
const {
  fakeUserFactory,
  testEndpoint
} = require('../../lib/testUtils');
const instanceMetaEndpoint = require('../../endpoints/instance-meta');

const CMR_ENVIRONMENT = randomString();
const CMR_PROVIDER = randomString();
let userModel;
let authHeaders;

test.before(async () => {
  process.env.UsersTable = randomString();
  userModel = new models.User();
  await userModel.createTable();

  process.env.CMR_ENVIRONMENT = CMR_ENVIRONMENT;
  process.env.cmr_provider = CMR_PROVIDER;


  const authToken = (await userModel.create(fakeUserFactory())).password;
  authHeaders = {
    Authorization: `Bearer ${authToken}`
  };
});

test('GET returns expected metadata', (t) => {
  const request = {
    httpMethod: 'GET',
    headers: authHeaders
  };

  return testEndpoint(instanceMetaEndpoint, request, (response) => {
    const body = JSON.parse(response.body);
    t.deepEqual(body, {
      cmr: {
        provider: CMR_PROVIDER,
        environment: CMR_ENVIRONMENT
      }
    });
  });
});

test('GET with unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };
  return testEndpoint(instanceMetaEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('GET without without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {}
  };

  return testEndpoint(instanceMetaEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});
