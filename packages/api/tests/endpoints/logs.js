'use strict';

const test = require('ava');

const logsEndpoint = require('../../endpoints/logs');
const {
  testEndpoint
} = require('../../lib/testUtils');
const assertions = require('../../lib/assertions');

test('GET without pathParameters and without an Authorization header returns an Authorization Missing response', (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {}
  };

  return testEndpoint(logsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('GET /stats/logs without an Authorization header returns an Authorization Missing response', (t) => {
  const request = {
    httpMethod: 'GET',
    resource: '/stats/logs',
    headers: {}
  };

  return testEndpoint(logsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('GET with pathParameters and without an Authorization header returns an Authorization Missing response', (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      executionName: 'asdf'
    },
    headers: {}
  };

  return testEndpoint(logsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});
