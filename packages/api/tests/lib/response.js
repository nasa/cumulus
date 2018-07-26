'use strict';

const test = require('ava');
const { User } = require('../../models');
const { fakeUserFactory } = require('../../lib/testUtils');
const {
  testUtils: { randomString }
} = require('@cumulus/common');
const {
  buildLambdaProxyResponse,
  getAuthorizationFailureResponse
} = require('../../lib/response');

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

test('buildLambdaProxyResponse sets a default status code of 200', (t) => {
  const response = buildLambdaProxyResponse();

  t.is(response.statusCode, 200);
});

test('buildLambdaProxyResponse sets the correct statusCode when specified', (t) => {
  const response = buildLambdaProxyResponse({ statusCode: 123 });

  t.is(response.statusCode, 123);
});

test('buildLambdaProxyResponse sets the Strict-Transport-Security header to max-age=31536000', (t) => {
  const response = buildLambdaProxyResponse();

  t.is(response.headers['Strict-Transport-Security'], 'max-age=31536000');
});

test('buildLambdaProxyResponse does not allow the Strict-Transport-Security header to be overwritten', (t) => {
  const response = buildLambdaProxyResponse({
    headers: {
      'Strict-Transport-Security': 'woohoo'
    }
  });

  t.is(response.headers['Strict-Transport-Security'], 'max-age=31536000');
});

test('buildLambdaProxyResponse sets the Access-Control-Allow-Origin header to *', (t) => {
  const response = buildLambdaProxyResponse();

  t.is(response.headers['Access-Control-Allow-Origin'], '*');
});

test('buildLambdaProxyResponse does not allow the Access-Control-Allow-Origin header to be overwritten', (t) => {
  const response = buildLambdaProxyResponse({
    headers: {
      'Access-Control-Allow-Origin': 'woohoo'
    }
  });

  t.is(response.headers['Access-Control-Allow-Origin'], '*');
});

test('buildLambdaProxyResponse sets headers provided as arguments', (t) => {
  const response = buildLambdaProxyResponse({
    headers: {
      username: 'scrosby'
    }
  });

  t.is(response.headers.username, 'scrosby');
});

test('buildLambdaProxyResponse sets the Content-Type header when the JSON flag is true and a Content-Type header is not specified', (t) => {
  const response = buildLambdaProxyResponse({
    body: {},
    json: true
  });

  t.is(response.headers['Content-Type'], 'application/json');
});

test('buildLambdaProxyResponse does not set the Content-Type header when the JSON flag is true and a Content-Type header is specified', (t) => {
  const response = buildLambdaProxyResponse({
    body: {},
    headers: {
      'Content-Type': 'custom-content-type'
    },
    json: true
  });

  t.is(response.headers['Content-Type'], 'custom-content-type');
});

test('buildLambdaProxyResponse does not set the Content-Type header when the JSON flag is true and a Content-Type header with different capitalization is specified', (t) => {
  const response = buildLambdaProxyResponse({
    body: {},
    headers: {
      'content-type': 'custom-content-type'
    },
    json: true
  });

  t.false(Object.keys(response.headers).includes('Content-Type'));
});

test('buildLambdaProxyResponse converts the body argument to JSON when the JSON flag is true and the body argument is an array', (t) => {
  const response = buildLambdaProxyResponse({
    body: [1, 2, 3],
    json: true
  });

  let parsedResponseBody;
  t.notThrows(() => {
    parsedResponseBody = JSON.parse(response.body);
  });
  t.deepEqual(parsedResponseBody, [1, 2, 3]);
});

test('buildLambdaProxyResponse converts the body argument to JSON when the JSON flag is true and the body argument is an object', (t) => {
  const response = buildLambdaProxyResponse({
    body: { a: 1, b: 2, c: 3 },
    json: true
  });

  let parsedResponseBody;
  t.notThrows(() => {
    parsedResponseBody = JSON.parse(response.body);
  });
  t.deepEqual(parsedResponseBody, { a: 1, b: 2, c: 3 });
});

test('buildLambdaProxyResponse throws a TypeError when the JSON flag is true and the body argument is a string', (t) => {
  const params = { body: 'some string', json: true };
  t.throws(
    () => buildLambdaProxyResponse(params),
    TypeError,
    'body must be an object or array when json is true'
  );
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
  t.is(response.statusCode, 401);
  t.is(response.headers['Content-Type'], 'application/json');
  t.true(response.headers['WWW-Authenticate'].includes('error="invalid_token"'));
  t.true(response.headers['WWW-Authenticate'].includes('error_description="Invalid Authorization token"'));

  const parsedResponseBody = JSON.parse(response.body);
  t.is(parsedResponseBody.message, 'Invalid Authorization token');
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
  t.is(response.statusCode, 401);
  t.is(response.headers['Content-Type'], 'application/json');
  t.true(response.headers['WWW-Authenticate'].includes('error="invalid_token"'));
  t.true(response.headers['WWW-Authenticate'].includes('error_description="The access token expired"'));

  const parsedResponseBody = JSON.parse(response.body);
  t.is(parsedResponseBody.message, 'The access token expired');
});
