'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');

const models = require('../../models');
const assertions = require('../../lib/assertions');
const executionsEndpoint = require('../../endpoints/executions');
const {
  fakeUserFactory,
  testEndpoint
} = require('../../lib/testUtils');

let authHeaders;
let userModel;
let executionsModel;
test.before(async () => {
  process.env.UsersTable = randomString();
  userModel = new models.User();
  await userModel.createTable();

  const authToken = (await userModel.create(fakeUserFactory())).password;
  authHeaders = {
    Authorization: `Bearer ${authToken}`
  };

  process.env.ExecutionsTable = randomString();
  executionsModel = new models.Execution();
  await executionsModel.createTable();
});

test.after.always(async () => {
  await Promise.all([
    userModel.deleteTable(),
    executionsModel.deleteTable()
  ]);
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

test('GET returns a single execution', async (t) => {
  const executionName = randomString();
  const arn = `arn:aws:states:us-east-1:12345678:execution:fakeStateMachine-abcdefg:${executionName}`;
  const execution = {
    status: 'completed',
    duration: 15.81,
    name: executionName,
    arn
  };
  await executionsModel.create(execution);

  const request = {
    httpMethod: 'GET',
    pathParameters: {
      arn
    },
    headers: authHeaders
  };

  return testEndpoint(executionsEndpoint, request, (response) => {
    const executionResponse = JSON.parse(response.body);
    t.is(executionResponse.arn, arn);
    t.is(executionResponse.name, executionName);
    t.truthy(executionResponse.duration);
    t.is(executionResponse.status, 'completed');
  });
});
