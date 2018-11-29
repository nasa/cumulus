'use strict';

const test = require('ava');

const { randomString } = require('@cumulus/common/test-utils');
const assertions = require('../../lib/assertions');
const models = require('../../models');
const {
  testEndpoint,
  createFakeJwtAuthToken,
  fakeAccessTokenFactory
} = require('../../lib/testUtils');
const {
  createJwtToken
} = require('../../lib/token');
const instanceMetaEndpoint = require('../../endpoints/instance-meta');

const CMR_ENVIRONMENT = randomString();
const CMR_PROVIDER = randomString();
let accessTokenModel;
let userModel;
let authHeaders;

test.before(async () => {
  process.env.UsersTable = randomString();
  userModel = new models.User();
  await userModel.createTable();

  process.env.AccessTokensTable = randomString();
  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  process.env.CMR_ENVIRONMENT = CMR_ENVIRONMENT;
  process.env.cmr_provider = CMR_PROVIDER;

  process.env.TOKEN_SECRET = randomString();
  const jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });
  authHeaders = {
    Authorization: `Bearer ${jwtAuthToken}`
  };
});

test.after.always(async () => {
  await userModel.deleteTable();
  await accessTokenModel.deleteTable();
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

test('GET with invalid access token returns an invalid token response', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };
  return testEndpoint(instanceMetaEndpoint, request, (response) => {
    assertions.isInvalidAccessTokenResponse(t, response);
  });
});

test('GET with unauthorized user token returns an unauthorized user response', async (t) => {
  const accessTokenRecord = await accessTokenModel.create(fakeAccessTokenFactory());
  const requestToken = createJwtToken(accessTokenRecord);

  const request = {
    httpMethod: 'GET',
    headers: {
      Authorization: `Bearer ${requestToken}`
    }
  };

  return testEndpoint(instanceMetaEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('GET without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {}
  };

  return testEndpoint(instanceMetaEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});
