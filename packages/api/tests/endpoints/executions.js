'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');

const models = require('../../models');
const assertions = require('../../lib/assertions');
const executionsEndpoint = require('../../endpoints/executions');
const {
  testEndpoint
} = require('../../lib/testUtils');

let userModel;
test.before(async () => {
  process.env.UsersTable = randomString();
  userModel = new models.User();
  await userModel.createTable();
});

test.after.always(async () => {
  await userModel.deleteTable();
});

test('GET without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      arn: 'asdf'
    },
    headers: {}
  };

  return testEndpoint(executionsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('GET with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      arn: 'asdf'
    },
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(executionsEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});
