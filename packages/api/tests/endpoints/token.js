'use strict';

const test = require('ava');
const { URL } = require('url');
const {
  testUtils: {
    randomString
  }
} = require('@cumulus/common');

const { OAuth2AuthenticationFailure } = require('../../lib/OAuth2');
const assertions = require('../../lib/assertions');
const {
  createJwtToken
} = require('../../lib/token');
const {
  fakeAccessTokenFactory,
  fakeUserFactory
} = require('../../lib/testUtils');
const { AccessToken, User } = require('../../models');
const { handleRequest } = require('../../endpoints/token');

let accessTokenModel;
let userModel;

test.before(async () => {
  process.env.TOKEN_SECRET = randomString();
  process.env.AccessTokensTable = randomString();
  process.env.UsersTable = randomString();

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  userModel = new User();
  await userModel.createTable();
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await userModel.deleteTable();
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
  const jwtToken = createJwtToken(getAccessTokenResponse);

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
  t.is(parsedBody.message.token, jwtToken);
});

test.serial('GET /token with a code and state results in a redirect to that state', async (t) => {
  const getAccessTokenResponse = fakeAccessTokenFactory();

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
  const getAccessTokenResponse = fakeAccessTokenFactory();
  const jwtToken = createJwtToken(getAccessTokenResponse);

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
  t.is(locationHeader.searchParams.get('token'), jwtToken);
});

test.serial('When using Earthdata Login, GET /token with a code stores the access token in DynamoDb', async (t) => {
  const getAccessTokenResponse = fakeAccessTokenFactory();
  const { accessToken, refreshToken } = getAccessTokenResponse;

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
});

test.serial('GET /refresh without a token results in an authorization failure response', async (t) => {
  const request = {
    httpMethod: 'POST',
    resource: '/refresh'
  };

  const response = await handleRequest(request);

  t.is(response.statusCode, 400);
  t.is(JSON.parse(response.body).message, 'Request requires a token');
});

test.serial('GET /refresh with an invalid token results in an authorization failure response', async (t) => {
  const request = {
    httpMethod: 'POST',
    resource: '/refresh',
    body: JSON.stringify({
      token: 'InvalidToken'
    })
  };

  const response = await handleRequest(request);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.serial('GET /refresh with an non-existent token results in an authorization failure response', async (t) => {
  const userRecord = fakeUserFactory();
  await userModel.create(userRecord);

  const accessTokenRecord = fakeAccessTokenFactory({ username: userRecord.userName });
  const jwtToken = createJwtToken(accessTokenRecord);

  const request = {
    httpMethod: 'POST',
    resource: '/refresh',
    body: JSON.stringify({
      token: jwtToken
    })
  };

  const response = await handleRequest(request);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.serial('GET /refresh with an unauthorized user results in an authorization failure response', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory();
  const jwtToken = createJwtToken(accessTokenRecord);

  const request = {
    httpMethod: 'POST',
    resource: '/refresh',
    body: JSON.stringify({
      token: jwtToken
    })
  };

  const response = await handleRequest(request);

  assertions.isUnauthorizedUserResponse(t, response);
});

test.serial('GET /refresh returns 500 if refresh token request fails', async (t) => {
  const mockOAuth2Provider = {
    refreshAccessToken: async () => {
      throw new Error('Refresh token request failed');
    }
  };

  const userRecord = fakeUserFactory();
  await userModel.create(userRecord);

  const initialTokenRecord = fakeAccessTokenFactory({ username: userRecord.userName });
  await accessTokenModel.create(initialTokenRecord);

  const requestJwtToken = createJwtToken(initialTokenRecord);

  const request = {
    httpMethod: 'POST',
    resource: '/refresh',
    body: JSON.stringify({
      token: requestJwtToken
    })
  };

  const response = await handleRequest(request, mockOAuth2Provider);
  t.is(response.statusCode, 500);
});

test.serial('GET /refresh with a valid token returns a refreshed token', async (t) => {
  const userRecord = fakeUserFactory();
  await userModel.create(userRecord);

  const initialTokenRecord = fakeAccessTokenFactory({ username: userRecord.userName });
  await accessTokenModel.create(initialTokenRecord);

  const requestJwtToken = createJwtToken(initialTokenRecord);

  const request = {
    httpMethod: 'POST',
    resource: '/refresh',
    body: JSON.stringify({
      token: requestJwtToken
    })
  };

  const refreshedTokenRecord = fakeAccessTokenFactory();
  const refreshedJwtToken = createJwtToken(refreshedTokenRecord);

  const mockOAuth2Provider = {
    refreshAccessToken: async () => refreshedTokenRecord
  };

  const response = await handleRequest(request, mockOAuth2Provider);

  t.is(response.statusCode, 200);

  const parsedBody = JSON.parse(response.body);
  t.is(parsedBody.token, refreshedJwtToken);

  t.false(await accessTokenModel.exists({
    accessToken: initialTokenRecord.accessToken
  }));
  t.true(await accessTokenModel.exists({
    accessToken: refreshedTokenRecord.accessToken
  }));
});

test.serial('DELETE /token without a token results in an authorization failure response', async (t) => {
  const request = {
    httpMethod: 'DELETE',
    resource: '/token'
  };

  const response = await handleRequest(request);

  t.is(response.statusCode, 400);
  t.is(JSON.parse(response.body).message, 'Request requires a token');
});

test.serial('DELETE /token with an invalid token results in an authorization failure response', async (t) => {
  const request = {
    httpMethod: 'DELETE',
    resource: '/token',
    queryStringParameters: {
      token: 'InvalidToken'
    }
  };

  const response = await handleRequest(request);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.serial('DELETE /token with an non-existent token results in an authorization failure response', async (t) => {
  const userRecord = fakeUserFactory();
  await userModel.create(userRecord);

  const accessTokenRecord = fakeAccessTokenFactory({ username: userRecord.userName });
  const jwtToken = createJwtToken(accessTokenRecord);

  const request = {
    httpMethod: 'DELETE',
    resource: '/token',
    queryStringParameters: {
      token: jwtToken
    }
  };

  const response = await handleRequest(request);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.serial('DELETE /token with an unauthorized user results in an authorization failure response', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory();
  const jwtToken = createJwtToken(accessTokenRecord);

  const request = {
    httpMethod: 'DELETE',
    resource: '/token',
    queryStringParameters: {
      token: jwtToken
    }
  };

  const response = await handleRequest(request);

  assertions.isUnauthorizedUserResponse(t, response);
});

test.serial('DELETE /token with a valid token results in a successful deletion response', async (t) => {
  const userRecord = fakeUserFactory();
  await userModel.create(userRecord);

  const accessTokenRecord = fakeAccessTokenFactory({ username: userRecord.userName });
  await accessTokenModel.create(accessTokenRecord);

  const requestJwtToken = createJwtToken(accessTokenRecord);

  const request = {
    httpMethod: 'DELETE',
    resource: '/token',
    queryStringParameters: {
      token: requestJwtToken
    }
  };

  const response = await handleRequest(request);

  t.false(await accessTokenModel.exists({ accessToken: accessTokenRecord.accessToken }))
  t.is(response.statusCode, 200);
  t.is(JSON.parse(response.body).message, 'Access token record was deleted');
});
