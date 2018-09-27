'use strict';

const test = require('ava');

const statsEndpoint = require('../../endpoints/stats');
const {
  testEndpoint
} = require('../../lib/testUtils');
const assertions = require('../../lib/assertions');

test('GET without pathParameters and without an Authorization header returns an Authorization Missing response', (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {}
  };

  return testEndpoint(statsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('GET /stats/histogram without an Authorization header returns an Authorization Missing response', (t) => {
  const request = {
    httpMethod: 'GET',
    resource: '/stats/histogram',
    headers: {}
  };

  return testEndpoint(statsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('GET /stats/aggregate without an Authorization header returns an Authorization Missing response', (t) => {
  const request = {
    httpMethod: 'GET',
    resource: '/stats/aggregate',
    headers: {}
  };

  return testEndpoint(statsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('GET /stats/average without an Authorization header returns an Authorization Missing response', (t) => {
  const request = {
    httpMethod: 'GET',
    resource: '/stats/average',
    headers: {}
  };

  return testEndpoint(statsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});
