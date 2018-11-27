'use strict';

const test = require('ava');
const {
  testUtils: { randomString }
} = require('@cumulus/common');

const { AccessToken, User } = require('../../models');
const { createJwtAuthToken, fakeAccessTokenFactory, fakeUserFactory } = require('../../lib/testUtils');
const assertions = require('../../lib/assertions');
const { createJwtToken } = require('../../lib/token');
const { getAuthorizationFailureResponse } = require('../../lib/response');

let accessTokenModel;
let usersTableName;
let userModel;

test.before(async () => {
  process.env.AccessTokensTable = randomString();
  usersTableName = randomString();
  process.env.UsersTable = usersTableName;
  userModel = new User();
  accessTokenModel = new AccessToken();
  process.env.TOKEN_SECRET = randomString();
  await accessTokenModel.createTable();
  await userModel.createTable();
});

test.after.always(async (_t) => {
  await userModel.deleteTable();
  await accessTokenModel.deleteTable();
});

test('getAuthorizationFailureResponse returns null if authorization succeeds', async (t) => {
  const accessToken = await createJwtAuthToken({ accessTokenModel, userModel });
  const request = {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  };

  const response = await getAuthorizationFailureResponse({ request, usersTable: usersTableName });

  t.is(response, null);
});

test('getAuthorizationFailureResponse returns an appropriate response when an Authorization header is not set', async (t) => {
  const request = {
    headers: {}
  };

  const response = await getAuthorizationFailureResponse({ request, usersTable: usersTableName });

  t.is(response.statusCode, 401);
  t.is(response.headers['Content-Type'], 'application/json');

  const parsedResponseBody = JSON.parse(response.body);
  t.is(parsedResponseBody.message, 'Authorization header missing');
});

test('getAuthorizationFailureResponse returns an appropriate response when an Authorization type is not "Bearer"', async (t) => {
  const request = {
    headers: {
      Authorization: 'SomeWrongScheme asdf'
    }
  };

  const response = await getAuthorizationFailureResponse({ request, usersTable: usersTableName });

  t.is(response.statusCode, 401);
  t.is(response.headers['Content-Type'], 'application/json');
  t.true(response.headers['WWW-Authenticate'].includes('error="invalid_request"'));
  t.true(response.headers['WWW-Authenticate'].includes('error_description="Authorization scheme must be Bearer"'));

  const parsedResponseBody = JSON.parse(response.body);
  t.is(parsedResponseBody.message, 'Authorization scheme must be Bearer');
});

test('getAuthorizationFailureResponse returns an appropriate response when a token is not specified', async (t) => {
  const request = {
    headers: {
      Authorization: 'Bearer'
    }
  };

  const response = await getAuthorizationFailureResponse({ request, usersTable: usersTableName });

  t.is(response.statusCode, 401);
  t.is(response.headers['Content-Type'], 'application/json');
  t.true(response.headers['WWW-Authenticate'].includes('error="invalid_request"'));
  t.true(response.headers['WWW-Authenticate'].includes('error_description="Missing token"'));

  const parsedResponseBody = JSON.parse(response.body);
  t.is(parsedResponseBody.message, 'Missing token');
});

test('getAuthorizationFailureResponse returns an appropriate response when an invalid access token is specifieid', async (t) => {
  const request = {
    headers: {
      Authorization: 'Bearer asdf'
    }
  };

  const response = await getAuthorizationFailureResponse({ request, usersTable: usersTableName });

  t.truthy(response);
  t.is(response.headers['Content-Type'], 'application/json');

  assertions.isInvalidAccessTokenResponse(t, response);
});

test('getAuthorizationFailureResponse returns an appropriate response when the token has expired', async (t) => {
  const {
    userName
  } = await userModel.create(fakeUserFactory());

  const accessTokenRecord = await accessTokenModel.create(
    fakeAccessTokenFactory({
      expirationTime: Date.now() - 60,
      username: userName
    })
  );

  const jwtToken = createJwtToken(accessTokenRecord);

  const request = {
    headers: {
      Authorization: `Bearer ${jwtToken}`
    }
  };

  const response = await getAuthorizationFailureResponse({ request, usersTable: usersTableName });

  t.truthy(response);
  assertions.isExpiredAccessTokenResponse(t, response);
});
