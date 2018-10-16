'use strict';

const test = require('ava');
const sinon = require('sinon');
const { randomString } = require('@cumulus/common/test-utils');
const workflowsList = require('../data/workflows_list.json');
const { S3 } = require('@cumulus/ingest/aws')

const models = require('../../models');
const workflowsEndpoint = require('../../endpoints/workflows');
const {
  fakeUserFactory,
  testEndpoint
} = require('../../lib/testUtils');
const assertions = require('../../lib/assertions');

let authHeaders;
let userModel;
test.before(async () => {
  process.env.UsersTable = randomString();

  userModel = new models.User();
  await userModel.createTable();

  const authToken = (await userModel.create(fakeUserFactory())).password;
  authHeaders = {
    Authorization: `Bearer ${authToken}`
  };
});

test.after.always(() => userModel.deleteTable());

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {}
  };

  return testEndpoint(workflowsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 GET with pathParameters and without an Authorization header returns an Authorization Missing response', (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      name: 'asdf'
    },
    headers: {}
  };

  return testEndpoint(workflowsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-912 GET without pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(workflowsEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('CUMULUS-912 GET with pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      name: 'asdf'
    },
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(workflowsEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('with an authorized user returns a list of workflows', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: authHeaders
  };

  const stub = sinon.stub(S3.prototype, 'get').resolves({
    results: workflowsList
  });

  return testEndpoint(workflowsEndpoint, request, (response) => {
    const { results } = JSON.parse(response.body);
    stub.restore();
    console.log(results);
    t.is(results.length, 2);
  });
});
