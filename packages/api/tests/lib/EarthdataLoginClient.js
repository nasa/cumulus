'use strict';

// TODO HTTP handling should be injected

const nock = require('nock');
const test = require('ava');
const { URL, URLSearchParams } = require('url');
const { ClientAuthenticationError } = require('../../lib/errors');
const EarthdataLoginClient = require('../../lib/EarthdataLoginClient');

test.beforeEach(() => {
  nock.cleanAll();
});

test('The EarthdataLogin constructor throws a TypeError if clientId is not specified', (t) => {
  const err = t.throws(() => {
    new EarthdataLoginClient({ // eslint-disable-line no-new
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
    new EarthdataLoginClient({ // eslint-disable-line no-new
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
    new EarthdataLoginClient({ // eslint-disable-line no-new
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
    new EarthdataLoginClient({ // eslint-disable-line no-new
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
    new EarthdataLoginClient({ // eslint-disable-line no-new
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
    new EarthdataLoginClient({ // eslint-disable-line no-new
      clientId: 'client-id',
      clientPassword: 'client-password',
      earthdataLoginUrl: 'http://www.example.com',
      redirectUri: 'asdf'
    });
  },
  TypeError);
});

test('EarthdataLogin.authorizationUrl() returns the correct URL when no state is specified', (t) => {
  const earthdataLoginClient = new EarthdataLoginClient({
    clientId: 'client-id',
    clientPassword: 'client-password',
    earthdataLoginUrl: 'http://www.example.com',
    redirectUri: 'http://www.example.com/cb'
  });

  const authorizationUrl = earthdataLoginClient.authorizationUrl();
  const parsedAuthorizationUrl = new URL(authorizationUrl);

  t.is(parsedAuthorizationUrl.origin, 'http://www.example.com');
  t.is(parsedAuthorizationUrl.pathname, '/oauth/authorize');
  t.is(parsedAuthorizationUrl.searchParams.get('response_type'), 'code');
  t.is(parsedAuthorizationUrl.searchParams.get('client_id'), 'client-id');
  t.is(parsedAuthorizationUrl.searchParams.get('redirect_uri'), 'http://www.example.com/cb');
  t.false(parsedAuthorizationUrl.searchParams.has('state'));
});

test('EarthdataLogin.authorizationUrl() returns the correct URL when a state is specified', (t) => {
  const earthdataLoginClient = new EarthdataLoginClient({
    clientId: 'client-id',
    clientPassword: 'client-password',
    earthdataLoginUrl: 'http://www.example.com',
    redirectUri: 'http://www.example.com/cb'
  });

  const authorizationUrl = earthdataLoginClient.authorizationUrl('the-state');
  const parsedAuthorizationUrl = new URL(authorizationUrl);

  t.is(parsedAuthorizationUrl.origin, 'http://www.example.com');
  t.is(parsedAuthorizationUrl.pathname, '/oauth/authorize');
  t.is(parsedAuthorizationUrl.searchParams.get('response_type'), 'code');
  t.is(parsedAuthorizationUrl.searchParams.get('client_id'), 'client-id');
  t.is(parsedAuthorizationUrl.searchParams.get('redirect_uri'), 'http://www.example.com/cb');
  t.is(parsedAuthorizationUrl.searchParams.get('state'), 'the-state');
});

test('EarthdataLogin.getAccessToken() throws a TypeError if authorizationCode is not set', async (t) => {
  const earthdataLoginClient = new EarthdataLoginClient({
    clientId: 'client-id',
    clientPassword: 'client-password',
    earthdataLoginUrl: 'http://www.example.com',
    redirectUri: 'http://www.example.com/cb'
  });

  try {
    await earthdataLoginClient.getAccessToken();
    t.fail('Expected getAccessToken to throw an error');
  }
  catch (err) {
    t.true(err instanceof TypeError);
    t.is(err.message, 'authorizationCode is required');
  }
});

test.serial('EarthdataLogin.getAccessToken() sends a correct request to the token endpoint', async (t) => {
  const earthdataLoginClient = new EarthdataLoginClient({
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

  await earthdataLoginClient.getAccessToken('authorization-code');

  t.true(tokenRequest.isDone());
});

test.serial('EarthdataLogin.getAccessToken() returns token information for a valid authorizationCode', async (t) => {
  const earthdataLoginClient = new EarthdataLoginClient({
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
    expirationTime,
    username
  } = await earthdataLoginClient.getAccessToken('authorization-code');
  const requestEndTime = Date.now();

  t.true(tokenRequest.isDone());

  t.is(accessToken, 'access-token');
  t.true(expirationTime >= requestStartTime + (100 * 1000));
  t.true(expirationTime <= requestEndTime + (100 * 1000));
  t.is(username, 'sidney');
});

test.serial('EarthdataLogin.getAccessToken() throws a ClientAuthenticationError error for an invalid authorizationCode', async (t) => {
  const earthdataLoginClient = new EarthdataLoginClient({
    clientId: 'client-id',
    clientPassword: 'client-password',
    earthdataLoginUrl: 'http://www.example.com',
    redirectUri: 'http://www.example.com/cb'
  });

  const tokenRequest = nock('http://www.example.com')
    .post('/oauth/token')
    .reply(400, { error: 'invalid_grant' });

  try {
    await earthdataLoginClient.getAccessToken('authorization-code');
    t.fail('Expected a ClientAuthenticationFailed error');
  }
  catch (err) {
    t.true(err instanceof ClientAuthenticationError);
  }

  t.true(tokenRequest.isDone());
});
