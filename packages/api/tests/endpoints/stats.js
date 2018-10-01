'use strict';

const test = require('ava');

const statsEndpoint = require('../../endpoints/stats');
const {
  testEndpoint
} = require('../../lib/testUtils');
const assertions = require('../../lib/assertions');

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {}
  };

  return testEndpoint(statsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 GET /stats/histogram without an Authorization header returns an Authorization Missing response', (t) => {
  const request = {
    httpMethod: 'GET',
    resource: '/stats/histogram',
    headers: {}
  };

  return testEndpoint(statsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 GET /stats/aggregate without an Authorization header returns an Authorization Missing response', (t) => {
  const request = {
    httpMethod: 'GET',
    resource: '/stats/aggregate',
    headers: {}
  };

  return testEndpoint(statsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 GET /stats/average without an Authorization header returns an Authorization Missing response', (t) => {
  const request = {
    httpMethod: 'GET',
    resource: '/stats/average',
    headers: {}
  };

  return testEndpoint(statsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

///

test('CUMULUS-912 GET without pathParameters and with an unauthorized user returns an unauthorized response', (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(statsEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('CUMULUS-912 GET /stats/histogram with an unauthorized user returns an unauthorized response', (t) => {
  const request = {
    httpMethod: 'GET',
    resource: '/stats/histogram',
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(statsEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('CUMULUS-912 GET /stats/aggregate with an unauthorized user returns an unauthorized response', (t) => {
  const request = {
    httpMethod: 'GET',
    resource: '/stats/aggregate',
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(statsEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('CUMULUS-912 GET /stats/average with an unauthorized user returns an unauthorized response', (t) => {
  const request = {
    httpMethod: 'GET',
    resource: '/stats/average',
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(statsEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});
