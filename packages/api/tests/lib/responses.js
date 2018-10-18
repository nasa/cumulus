'use strict';

const test = require('ava');
const {
  testUtils: { randomString }
} = require('@cumulus/common');

const { User } = require('../../models');
const { fakeUserFactory } = require('../../lib/testUtils');
const {
  LambdaProxyResponse
} = require('../../lib/responses');

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

test('new LambdaProxyResponse sets a default status code of 200', (t) => {
  const response = new LambdaProxyResponse();

  t.is(response.statusCode, 200);
});

test('new LambdaProxyResponse sets the correct statusCode when specified', (t) => {
  const response = new LambdaProxyResponse({ statusCode: 123 });

  t.is(response.statusCode, 123);
});

test('new LambdaProxyResponse sets the Strict-Transport-Security header to max-age=31536000', (t) => {
  const response = new LambdaProxyResponse();

  t.is(response.headers['Strict-Transport-Security'], 'max-age=31536000');
});

test('new LambdaProxyResponse does not allow the Strict-Transport-Security header to be overwritten', (t) => {
  const response = new LambdaProxyResponse({
    headers: {
      'Strict-Transport-Security': 'woohoo'
    }
  });

  t.is(response.headers['Strict-Transport-Security'], 'max-age=31536000');
});

test('new LambdaProxyResponse sets the Access-Control-Allow-Origin header to *', (t) => {
  const response = new LambdaProxyResponse();

  t.is(response.headers['Access-Control-Allow-Origin'], '*');
});

test('new LambdaProxyResponse does not allow the Access-Control-Allow-Origin header to be overwritten', (t) => {
  const response = new LambdaProxyResponse({
    headers: {
      'Access-Control-Allow-Origin': 'woohoo'
    }
  });

  t.is(response.headers['Access-Control-Allow-Origin'], '*');
});

test('new LambdaProxyResponse sets headers provided as arguments', (t) => {
  const response = new LambdaProxyResponse({
    headers: {
      username: 'scrosby'
    }
  });

  t.is(response.headers.username, 'scrosby');
});

test('new LambdaProxyResponse sets the Content-Type header when the JSON flag is true and a Content-Type header is not specified', (t) => {
  const response = new LambdaProxyResponse({
    body: {},
    json: true
  });

  t.is(response.headers['Content-Type'], 'application/json');
});

test('new LambdaProxyResponse does not set the Content-Type header when the JSON flag is true and a Content-Type header is specified', (t) => {
  const response = new LambdaProxyResponse({
    body: {},
    headers: {
      'Content-Type': 'custom-content-type'
    },
    json: true
  });

  t.is(response.headers['Content-Type'], 'custom-content-type');
});

test('new LambdaProxyResponse does not set the Content-Type header when the JSON flag is true and a Content-Type header with different capitalization is specified', (t) => {
  const response = new LambdaProxyResponse({
    body: {},
    headers: {
      'content-type': 'custom-content-type'
    },
    json: true
  });

  t.false(Object.keys(response.headers).includes('Content-Type'));
});

test('new LambdaProxyResponse converts the body argument to JSON when the JSON flag is true and the body argument is an array', (t) => {
  const response = new LambdaProxyResponse({
    body: [1, 2, 3],
    json: true
  });

  let parsedResponseBody;
  t.notThrows(() => {
    parsedResponseBody = JSON.parse(response.body);
  });
  t.deepEqual(parsedResponseBody, [1, 2, 3]);
});

test('new LambdaProxyResponse converts the body argument to JSON when the JSON flag is true and the body argument is an object', (t) => {
  const response = new LambdaProxyResponse({
    body: { a: 1, b: 2, c: 3 },
    json: true
  });

  let parsedResponseBody;
  t.notThrows(() => {
    parsedResponseBody = JSON.parse(response.body);
  });
  t.deepEqual(parsedResponseBody, { a: 1, b: 2, c: 3 });
});

test('new LambdaProxyResponse throws a TypeError when the JSON flag is true and the body argument is a string', (t) => {
  const params = { body: 'some string', json: true };
  t.throws(
    () => new LambdaProxyResponse(params),
    TypeError,
    'body must be an object or array when json is true'
  );
});
