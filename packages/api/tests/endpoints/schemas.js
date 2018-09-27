'use strict';

const test = require('ava');

const schemasEndpoint = require('../../endpoints/schemas');
const {
  testEndpoint
} = require('../../lib/testUtils');
const assertions = require('../../lib/assertions');

test('GET with pathParameters and without an Authorization header returns an Authorization Missing response', (t) => {
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
