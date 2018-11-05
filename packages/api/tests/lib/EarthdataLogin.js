'use strict';

const nock = require('nock');
const test = require('ava');
const { URL, URLSearchParams } = require('url');

const EarthdataLogin = require('../../lib/EarthdataLogin');
const {
  OAuth2AuthenticationError,
  OAuth2AuthenticationFailure
} = require('../../lib/OAuth2');

test.beforeEach(() => {
  nock.cleanAll();
});

test('The EarthdataLogin constructor throws a TypeError if clientId is not specified', (t) => {
  const err = t.throws(() => {
    new EarthdataLogin({
      clientPassword: 'client-password',
      earthdataLoginUrl: 'http://www.example.com',
      redirectUri: 'http://www.example.com/cb'
    });
  },
  TypeError);

  t.is(err.message, 'clientId is required');
});

test('The EarthdataLogin constructor throws a TypeError if clientPassword is not specified', (t) => {
  const err = t.throws(() => {
    new EarthdataLogin({
      clientId: 'client-id',
      earthdataLoginUrl: 'http://www.example.com',
      redirectUri: 'http://www.example.com/cb'
    });
  },
  TypeError);

  t.is(err.message, 'clientPassword is required');
});

test('The EarthdataLogin constructor throws a TypeError if earthdataLoginUrl is not specified', (t) => {
  const err = t.throws(() => {
    new EarthdataLogin({
      clientId: 'client-id',
      clientPassword: 'client-password',
      redirectUri: 'http://www.example.com/cb'
    });
  },
  TypeError);

  t.is(err.message, 'earthdataLoginUrl is required');
});

test('The EarthdataLogin constructor throws a TypeError if earthdataLoginUrl is not a valid URL', (t) => {
  t.throws(() => {
    new EarthdataLogin({
      clientId: 'client-id',
      clientPassword: 'client-password',
      earthdataLoginUrl: 'asdf',
      redirectUri: 'http://www.example.com/cb'
    });
  },
  TypeError);
});

test('The EarthdataLogin constructor throws a TypeError if redirectUri is not specified', (t) => {
  const err = t.throws(() => {
    new EarthdataLogin({
      clientId: 'client-id',
      clientPassword: 'client-password',
      earthdataLoginUrl: 'http://www.example.com'
    });
  },
  TypeError);

  t.is(err.message, 'redirectUri is required');
});

test('The EarthdataLogin constructor throws a TypeError if redirectUri is not a valid URL', (t) => {
  t.throws(() => {
    new EarthdataLogin({
      clientId: 'client-id',
      clientPassword: 'client-password',
      earthdataLoginUrl: 'http://www.example.com',
      redirectUri: 'asdf'
    });
  },
  TypeError);
});

test('EarthdataLogin.getAuthorizationUrl() returns the correct URL when no state is specified', (t) => {
  const earthdataLogin = new EarthdataLogin({
    clientId: 'client-id',
    clientPassword: 'client-password',
    earthdataLoginUrl: 'http://www.example.com',
    redirectUri: 'http://www.example.com/cb'
  });

  const authorizationUrl = earthdataLogin.getAuthorizationUrl();
  const parsedAuthorizationUrl = new URL(authorizationUrl);

  t.is(parsedAuthorizationUrl.origin, 'http://www.example.com');
  t.is(parsedAuthorizationUrl.pathname, '/oauth/authorize');
  t.is(parsedAuthorizationUrl.searchParams.get('response_type'), 'code');
  t.is(parsedAuthorizationUrl.searchParams.get('client_id'), 'client-id');
  t.is(parsedAuthorizationUrl.searchParams.get('redirect_uri'), 'http://www.example.com/cb');
  t.false(parsedAuthorizationUrl.searchParams.has('state'));
});

test('EarthdataLogin.getAuthorizationUrl() returns the correct URL when a state is specified', (t) => {
  const earthdataLogin = new EarthdataLogin({
    clientId: 'client-id',
    clientPassword: 'client-password',
    earthdataLoginUrl: 'http://www.example.com',
    redirectUri: 'http://www.example.com/cb'
  });

  const authorizationUrl = earthdataLogin.getAuthorizationUrl('the-state');
  const parsedAuthorizationUrl = new URL(authorizationUrl);

  t.is(parsedAuthorizationUrl.origin, 'http://www.example.com');
  t.is(parsedAuthorizationUrl.pathname, '/oauth/authorize');
  t.is(parsedAuthorizationUrl.searchParams.get('response_type'), 'code');
  t.is(parsedAuthorizationUrl.searchParams.get('client_id'), 'client-id');
  t.is(parsedAuthorizationUrl.searchParams.get('redirect_uri'), 'http://www.example.com/cb');
  t.is(parsedAuthorizationUrl.searchParams.get('state'), 'the-state');
});

test('EarthdataLogin.getAccessToken() throws a TypeError if authorizationCode is not set', async (t) => {
  const earthdataLogin = new EarthdataLogin({
    clientId: 'client-id',
    clientPassword: 'client-password',
    earthdataLoginUrl: 'http://www.example.com',
    redirectUri: 'http://www.example.com/cb'
  });

  try {
    await earthdataLogin.getAccessToken();
    t.fail('Expected getAccessToken to throw an error');
  }
  catch (err) {
    t.true(err instanceof TypeError);
    t.is(err.message, 'authorizationCode is required');
  }
});

test.serial('EarthdataLogin.getAccessToken() sends a correct request to the token endpoint', async (t) => {
  const earthdataLogin = new EarthdataLogin({
    clientId: 'client-id',
    clientPassword: 'client-password',
    earthdataLoginUrl: 'http://www.example.com',
    redirectUri: 'http://www.example.com/cb'
  });

  const tokenRequest = nock(
    'http://www.example.com',
    {
      reqHeaders: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    }
  )
    .post(
      '/oauth/token',
      (body) => {
        const parsedBody = new URLSearchParams(body);

        return parsedBody.get('grant_type') === 'authorization_code'
          && parsedBody.get('code') === 'authorization-code'
          && parsedBody.get('redirect_uri') === 'http://www.example.com/cb';
      }
    )
    .basicAuth({
      user: 'client-id',
      pass: 'client-password'
    })
    .reply(
      200,
      {
        access_token: 'access-token',
        token_type: 'bearer',
        expires_in: 123,
        refresh_token: 'refresh-token',
        endpoint: '/api/users/sidney'
      }
    );

  await earthdataLogin.getAccessToken('authorization-code');

  t.true(tokenRequest.isDone());
});

test.serial('EarthdataLogin.getAccessToken() returns token information for a valid authorizationCode', async (t) => {
  const earthdataLogin = new EarthdataLogin({
    clientId: 'client-id',
    clientPassword: 'client-password',
    earthdataLoginUrl: 'http://www.example.com',
    redirectUri: 'http://www.example.com/cb'
  });

  const tokenRequest = nock('http://www.example.com')
    .post('/oauth/token')
    .reply(
      200,
      {
        access_token: 'access-token',
        token_type: 'bearer',
        expires_in: 100,
        refresh_token: 'refresh-token',
        endpoint: '/api/users/sidney'
      }
    );

  const requestStartTime = Date.now();
  const {
    accessToken,
    refreshToken,
    expirationTime,
    username
  } = await earthdataLogin.getAccessToken('authorization-code');
  const requestEndTime = Date.now();

  t.true(tokenRequest.isDone());

  t.is(accessToken, 'access-token');
  t.is(refreshToken, 'refresh-token');
  t.true(expirationTime >= requestStartTime + 86400000);
  t.true(expirationTime <= requestEndTime + 86400000);
  t.is(username, 'sidney');
});

test.serial('EarthdataLogin.getAccessToken() throws an OAuth2AuthenticationFailure error for an invalid authorizationCode', async (t) => {
  const earthdataLogin = new EarthdataLogin({
    clientId: 'client-id',
    clientPassword: 'client-password',
    earthdataLoginUrl: 'http://www.example.com',
    redirectUri: 'http://www.example.com/cb'
  });

  const tokenRequest = nock('http://www.example.com')
    .post('/oauth/token')
    .reply(400);

  try {
    await earthdataLogin.getAccessToken('authorization-code');
    t.fail('Expected a OAuth2AuthenticationFailure error');
  }
  catch (err) {
    t.true(err instanceof OAuth2AuthenticationFailure);
  }

  t.true(tokenRequest.isDone());
});

test.serial('EarthdataLogin.getAccessToken() throws an OAuth2AuthenticationError error if there is a problem with the Earthdata Login service', async (t) => {
  const earthdataLogin = new EarthdataLogin({
    clientId: 'client-id',
    clientPassword: 'client-password',
    earthdataLoginUrl: 'http://www.example.com',
    redirectUri: 'http://www.example.com/cb'
  });

  const tokenRequest = nock('http://www.example.com')
    .post('/oauth/token')
    .reply(500);

  try {
    await earthdataLogin.getAccessToken('authorization-code');
    t.fail('Expected a OAuth2AuthenticationError error');
  }
  catch (err) {
    t.true(err instanceof OAuth2AuthenticationError);
  }

  t.true(tokenRequest.isDone());
});
