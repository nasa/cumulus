'use strict';

const test = require('ava');
const { URL } = require('url');
const {
  testUtils: {
    randomString
  }
} = require('@cumulus/common');

const { OAuth2AuthenticationFailure } = require('../../lib/OAuth2');
const { AccessToken } = require('../../models');
const { handleRequest } = require('../../endpoints/token');

let accessTokenModel;

test.before(async () => {
  process.env.AccessTokensTable = randomString();

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
});

test.serial('A request for anything other that GET /token results in a 404', async (t) => {
  const request = {
    httpMethod: 'GET',
    resource: '/invalid'
  };

  const response = await handleRequest(request);

  t.is(response.statusCode, 404);
});

test.serial('GET /token without a code properly requests the authorization URL from the oAuth2 provider', async (t) => {
  const mockOAuth2Provider = {
    getAuthorizationUrl: (state) => {
      t.is(state, 'my-state');
    }
  };

  const request = {
    httpMethod: 'GET',
    resource: '/token',
    queryStringParameters: {
      state: 'my-state'
    }
  };

  await handleRequest(request, mockOAuth2Provider);
});

test.serial('GET /token without a code returns a redirect authorization URL from the oAuth2 provider', async (t) => {
  const mockOAuth2Provider = {
    getAuthorizationUrl: () => 'http://www.example.com'
  };

  const request = {
    httpMethod: 'GET',
    resource: '/token',
    queryStringParameters: {
      state: 'my-state'
    }
  };

  const response = await handleRequest(request, mockOAuth2Provider);

  t.is(response.statusCode, 301);
  t.is(response.headers.Location, 'http://www.example.com');
});

test.serial('GET /token with an invalid code results in an authorization failure response', async (t) => {
  const mockOAuth2Provider = {
    getAccessToken: async (authorizationCode) => {
      t.is(authorizationCode, 'invalid-authorization-code');
      throw new OAuth2AuthenticationFailure('Failed to get authorization token');
    }
  };

  const request = {
    httpMethod: 'GET',
    resource: '/token',
    queryStringParameters: {
      code: 'invalid-authorization-code'
    }
  };

  const response = await handleRequest(request, mockOAuth2Provider);

  t.is(response.statusCode, 401);
  t.is(JSON.parse(response.body).message, 'Failed to get authorization token');
});

test.serial('GET /token with a code but no state returns the access token', async (t) => {
  const getAccessTokenResponse = {
    username: 'my-username',
    accessToken: 'my-access-token',
    refreshToken: 'my-refresh-token',
    expirationTime: 12345
  };

  const mockOAuth2Provider = {
    getAccessToken: async () => getAccessTokenResponse
  };

  const request = {
    httpMethod: 'GET',
    resource: '/token',
    queryStringParameters: {
      code: 'my-authorization-code'
    }
  };

  const response = await handleRequest(request, mockOAuth2Provider);

  t.is(response.statusCode, 200);

  const parsedBody = JSON.parse(response.body);
  t.is(parsedBody.message.token, 'my-access-token');
});

test.serial('GET /token with a code and state results in a redirect to that state', async (t) => {
  const getAccessTokenResponse = {
    username: 'my-username',
    accessToken: 'my-access-token',
    refreshToken: 'my-refresh-token',
    expirationTime: 12345
  };

  const mockOAuth2Provider = {
    getAccessToken: async () => getAccessTokenResponse
  };

  const request = {
    httpMethod: 'GET',
    resource: '/token',
    queryStringParameters: {
      code: 'my-authorization-code',
      state: 'http://www.example.com/state'
    }
  };

  const response = await handleRequest(request, mockOAuth2Provider);

  t.is(response.statusCode, 301);

  const locationHeader = new URL(response.headers.Location);

  t.is(locationHeader.origin, 'http://www.example.com');
  t.is(locationHeader.pathname, '/state');
});

test.serial('GET /token with a code and state results in a redirect containing the access token', async (t) => {
  const getAccessTokenResponse = {
    username: 'my-username',
    accessToken: 'my-access-token',
    refreshToken: 'my-refresh-token',
    expirationTime: 12345
  };

  const mockOAuth2Provider = {
    getAccessToken: async () => getAccessTokenResponse
  };

  const request = {
    httpMethod: 'GET',
    resource: '/token',
    queryStringParameters: {
      code: 'my-authorization-code',
      state: 'http://www.example.com/state'
    }
  };

  const response = await handleRequest(request, mockOAuth2Provider);

  t.is(response.statusCode, 301);

  const locationHeader = new URL(response.headers.Location);

  t.is(locationHeader.searchParams.get('token'), 'my-access-token');
});

test.serial('When using Earthdata Login, GET /token with a code stores the access token in DynamoDb', async (t) => {
  const accessToken = randomString();
  const username = randomString();
  const refreshToken = randomString();
  const expirationTime = 12345;

  const getAccessTokenResponse = {
    accessToken,
    expirationTime,
    refreshToken,
    username
  };

  const mockOAuth2Provider = {
    getAccessToken: async () => getAccessTokenResponse
  };

  const request = {
    httpMethod: 'GET',
    resource: '/token',
    queryStringParameters: {
      code: 'my-authorization-code',
      state: 'http://www.example.com/state'
    }
  };

  await handleRequest(request, mockOAuth2Provider);

  const tokenAfter = await accessTokenModel.get({ accessToken });

  t.is(tokenAfter.accessToken, accessToken);
  t.is(tokenAfter.refreshToken, refreshToken);
  t.is(tokenAfter.username, username);
  t.is(tokenAfter.expirationTime, expirationTime);
});
