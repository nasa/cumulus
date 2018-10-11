'use strict';

const test = require('ava');
const {
  testUtils: { randomString }
} = require('@cumulus/common');

const { User } = require('../../models');
const { fakeUserFactory } = require('../../lib/testUtils');
const { getAuthorizationFailureResponse } = require('../../lib/response');

let usersTableName;
let userModel;

test.before(async () => {
  process.env.UsersTable = randomString();
  userModel = new User();
  await userModel.createTable();
});

test.beforeEach(async (t) => {
  const { userName, password } = await userModel.create(fakeUserFactory());
  t.context.usersToDelete = [userName];
  t.context.userName = userName;
  t.context.token = password;
});

test.afterEach(async (t) => {
  await Promise.all(
    t.context.usersToDelete.map(((userName) =>
      userModel.delete(userName)))
  );
});

test.after.always(async (_t) => {
  await userModel.deleteTable();
});

test('getAuthorizationFailureResponse returns null if authorization succeeds', async (t) => {
  const request = {
    headers: {
      Authorization: `Bearer ${t.context.token}`
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

test('getAuthorizationFailureResponse returns an appropriate response when a token is not found in the Users table', async (t) => {
  const request = {
    headers: {
      Authorization: 'Bearer asdf'
    }
  };

  const response = await getAuthorizationFailureResponse({ request, usersTable: usersTableName });

  t.truthy(response);
  t.is(response.statusCode, 403);

  t.is(response.headers['Content-Type'], 'application/json');

  const parsedResponseBody = JSON.parse(response.body);
  t.is(parsedResponseBody.message, 'User not authorized');
});

test('getAuthorizationFailureResponse returns an appropriate response when the token has expired', async (t) => {
  const {
    userName,
    password
  } = await userModel.create(fakeUserFactory({ expires: Date.now() - 60 }));

  t.context.usersToDelete.push(userName);

  const request = {
    headers: {
      Authorization: `Bearer ${password}`
    }
  };

  const response = await getAuthorizationFailureResponse({ request, usersTable: usersTableName });

  t.truthy(response);
  t.is(response.statusCode, 403);

  t.is(response.headers['Content-Type'], 'application/json');

  const parsedResponseBody = JSON.parse(response.body);
  t.is(parsedResponseBody.message, 'Access token has expired');
});

test.todo('getAuthorizationFailureResponse returns an appropriate response if the user does not have an expiration');
