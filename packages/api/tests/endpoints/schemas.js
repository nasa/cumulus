'use strict';

const test = require('ava');

const schemasEndpoint = require('../../endpoints/schemas');
const {
  testEndpoint
} = require('../../lib/testUtils');
const assertions = require('../../lib/assertions');

test('CUMULUS-911 GET with pathParameters and without an Authorization header returns an Authorization Missing response', (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      schemaName: 'asdf'
    },
    headers: {}
  };

  return testEndpoint(schemasEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-912 GET with pathParameters and with an unauthorized user returns an unauthorized response', (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      schemaName: 'asdf'
    },
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(schemasEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});
