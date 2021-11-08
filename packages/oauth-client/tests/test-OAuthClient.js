const cryptoRandomString = require('crypto-random-string');
const nock = require('nock');
const test = require('ava');

const { OAuthClient } = require('../dist');

const randomString = () => cryptoRandomString({ length: 6 });

const randomId = (prefix, separator = '-') =>
  [prefix, randomString()].filter((x) => x).join(separator);

const randomUrl = () => `http://${randomString()}.local`;

const buildAuthClient = () =>
  new OAuthClient({
    clientId: randomId('client-id'),
    clientPassword: randomId('client-password'),
    loginUrl: randomUrl(),
    redirectUri: randomUrl(),
  });

const nockAuthCall = (params) => {
  const {
    authClient,
    path,
    requestBody,
    requestHeaders = {},
    responseStatus,
    responseBody,
  } = params;

  return nock(
    authClient.loginUrl,
    { reqheaders: requestHeaders }
  )
    .post(path, requestBody)
    .basicAuth({
      user: authClient.clientId,
      pass: authClient.clientPassword,
    })
    .reply(responseStatus, responseBody);
};

test.before(() => {
  nock.disableNetConnect();
});

test('The OAuthClient constructor throws a TypeError if clientId is not specified', (t) => {
  t.throws(
    () => {
      new OAuthClient({
        clientPassword: 'client-password',
        loginUrl: 'http://www.example.com',
        redirectUri: 'http://www.example.com/cb',
      });
    },
    {
      instanceOf: TypeError,
      message: 'clientId is required',
    }
  );
});

test('The OAuthClient constructor throws a TypeError if clientPassword is not specified', (t) => {
  t.throws(
    () => {
      new OAuthClient({
        clientId: 'client-id',
        loginUrl: 'http://www.example.com',
        redirectUri: 'http://www.example.com/cb',
      });
    },
    {
      instanceOf: TypeError,
      message: 'clientPassword is required',
    }
  );
});

test('The OAuthClient constructor throws a TypeError if loginUrl is not specified', (t) => {
  t.throws(
    () => {
      new OAuthClient({
        clientId: 'client-id',
        clientPassword: 'client-password',
        redirectUri: 'http://www.example.com/cb',
      });
    },
    {
      instanceOf: TypeError,
      message: 'loginUrl is required',
    }
  );
});

test('The OAuthClient constructor throws a TypeError if AuthClientUrl is not a valid URL', (t) => {
  t.throws(
    () => {
      new OAuthClient({
        clientId: 'client-id',
        clientPassword: 'client-password',
        loginUrl: 'asdf',
        redirectUri: 'http://www.example.com/cb',
      });
    },
    { instanceOf: TypeError }
  );
});

test('The OAuthClient constructor throws a TypeError if redirectUri is not specified', (t) => {
  t.throws(
    () => {
      new OAuthClient({
        clientId: 'client-id',
        clientPassword: 'client-password',
        loginUrl: 'http://www.example.com',
      });
    },
    {
      instanceOf: TypeError,
      message: 'redirectUri is required',
    }
  );
});

test('The OAuthClient constructor throws a TypeError if redirectUri is not a valid URL', (t) => {
  t.throws(
    () => {
      new OAuthClient({
        clientId: 'client-id',
        clientPassword: 'client-password',
        loginUrl: 'http://www.example.com',
        redirectUri: 'asdf',
      });
    },
    { instanceOf: TypeError }
  );
});

test('OAuthClient.getAuthorizationUrl() returns the correct URL when no state is specified', (t) => {
  const authClient = buildAuthClient();

  const authorizationUrl = authClient.getAuthorizationUrl();
  const parsedAuthorizationUrl = new URL(authorizationUrl);

  t.is(parsedAuthorizationUrl.origin, authClient.loginUrl);
  t.is(parsedAuthorizationUrl.pathname, '/oauth/authorize');
  t.is(parsedAuthorizationUrl.searchParams.get('response_type'), 'code');
  t.is(parsedAuthorizationUrl.searchParams.get('client_id'), authClient.clientId);
  t.is(parsedAuthorizationUrl.searchParams.get('redirect_uri'), authClient.redirectUri);
  t.false(parsedAuthorizationUrl.searchParams.has('state'));
});

test('OAuthClient.getAuthorizationUrl() returns the correct URL when a state is specified', (t) => {
  const authClient = buildAuthClient();

  const authorizationUrl = authClient.getAuthorizationUrl('the-state');
  const parsedAuthorizationUrl = new URL(authorizationUrl);

  t.is(parsedAuthorizationUrl.origin, authClient.loginUrl);
  t.is(parsedAuthorizationUrl.pathname, '/oauth/authorize');
  t.is(parsedAuthorizationUrl.searchParams.get('response_type'), 'code');
  t.is(parsedAuthorizationUrl.searchParams.get('client_id'), authClient.clientId);
  t.is(parsedAuthorizationUrl.searchParams.get('redirect_uri'), authClient.redirectUri);
  t.is(parsedAuthorizationUrl.searchParams.get('state'), 'the-state');
});

test('OAuthClient.getAccessToken() throws a TypeError if authorizationCode is not set', async (t) => {
  const authClient = buildAuthClient();

  await t.throwsAsync(
    () => authClient.getAccessToken(),
    {
      instanceOf: TypeError,
      message: 'authorizationCode is required',
    }
  );
});

test('OAuthClient.getAccessToken() sends a correct request to the token endpoint', async (t) => {
  const authClient = buildAuthClient();

  nock(
    authClient.loginUrl,
    {
      reqheaders: {
        'content-type': 'application/x-www-form-urlencoded',
      },
    }
  )
    .post(
      '/oauth/token',
      (body) => {
        const parsedBody = new URLSearchParams(body);

        return parsedBody.get('grant_type') === 'authorization_code'
            && parsedBody.get('code') === 'authorization-code'
            && parsedBody.get('redirect_uri') === authClient.redirectUri;
      }
    )
    .basicAuth({
      user: authClient.clientId,
      pass: authClient.clientPassword,
    })
    .reply(
      200,
      {
        access_token: 'access-token',
        token_type: 'bearer',
        expires_in: 123,
        refresh_token: 'refresh-token',
        endpoint: '/api/users/sidney',
      }
    );

  await authClient.getAccessToken('authorization-code');

  t.pass();
});

test('OAuthClient.getAccessToken() returns token information for a valid authorizationCode', async (t) => {
  const authClient = buildAuthClient();

  nockAuthCall({
    authClient,
    path: '/oauth/token',
    responseStatus: 200,
    responseBody: {
      access_token: 'access-token',
      token_type: 'bearer',
      expires_in: 100,
      refresh_token: 'refresh-token',
      endpoint: '/api/users/sidney',
    },
  });

  const requestStartTime = Math.floor(Date.now() / 1000);
  const {
    accessToken,
    refreshToken,
    expirationTime,
    username,
  } = await authClient.getAccessToken('authorization-code');
  const requestEndTime = Math.floor(Date.now() / 1000);

  t.is(accessToken, 'access-token');
  t.is(refreshToken, 'refresh-token');
  t.true(expirationTime >= requestStartTime + 100);
  t.true(expirationTime <= requestEndTime + 100);
  t.is(username, 'sidney');
});

test('OAuthClient.getAccessToken() returns token information if client API does not return a valid endpoint', async (t) => {
  const authClient = buildAuthClient();

  nockAuthCall({
    authClient,
    path: '/oauth/token',
    responseStatus: 200,
    responseBody: {
      access_token: 'access-token',
      token_type: 'bearer',
      expires_in: 100,
      refresh_token: 'refresh-token',
    },
  });

  const requestStartTime = Math.floor(Date.now() / 1000);
  const {
    accessToken,
    refreshToken,
    expirationTime,
    username,
  } = await authClient.getAccessToken('authorization-code');
  const requestEndTime = Math.floor(Date.now() / 1000);

  t.is(accessToken, 'access-token');
  t.is(refreshToken, 'refresh-token');
  t.true(expirationTime >= requestStartTime + 100);
  t.true(expirationTime <= requestEndTime + 100);
  // username is derived from "endpoint", which is not present in this response
  t.is(username, undefined);
});

test('OAuthClient.refreshAccessToken() throws a TypeError if refreshToken is not set', async (t) => {
  const authClient = buildAuthClient();

  await t.throwsAsync(
    () => authClient.refreshAccessToken(),
    {
      instanceOf: TypeError,
      message: 'refreshToken is required',
    }
  );
});

test('OAuthClient.refreshAccessToken() sends a correct request to the token endpoint', async (t) => {
  const authClient = buildAuthClient();

  nock(
    authClient.loginUrl,
    {
      reqheaders: {
        'content-type': 'application/x-www-form-urlencoded',
      },
    }
  )
    .post(
      '/oauth/token',
      (body) => {
        const parsedBody = new URLSearchParams(body);

        return parsedBody.get('grant_type') === 'refresh_token'
            && parsedBody.get('refresh_token') === 'refresh-token';
      }
    )
    .basicAuth({
      user: authClient.clientId,
      pass: authClient.clientPassword,
    })
    .reply(
      200,
      {
        access_token: 'access-token',
        token_type: 'bearer',
        expires_in: 123,
        refresh_token: 'refresh-token',
        endpoint: '/api/users/sidney',
      }
    );

  await authClient.refreshAccessToken('refresh-token');

  t.pass();
});

test('OAuthClient.refreshAccessToken() returns token information for a valid refreshToken', async (t) => {
  const authClient = buildAuthClient();

  nockAuthCall({
    authClient,
    path: '/oauth/token',
    responseStatus: 200,
    responseBody: {
      access_token: 'access-token',
      token_type: 'bearer',
      expires_in: 100,
      refresh_token: 'refresh-token',
      endpoint: '/api/users/sidney',
    },
  });

  const requestStartTime = Math.floor(Date.now() / 1000);
  const {
    accessToken,
    refreshToken,
    expirationTime,
    username,
  } = await authClient.refreshAccessToken('refresh-token');
  const requestEndTime = Math.floor(Date.now() / 1000);

  t.is(accessToken, 'access-token');
  t.is(refreshToken, 'refresh-token');
  t.true(expirationTime >= requestStartTime + 100);
  t.true(expirationTime <= requestEndTime + 100);
  t.is(username, 'sidney');
});

test('OAuthClient.refreshAccessToken() returns token information if client API does not return a valid endpoint', async (t) => {
  const authClient = buildAuthClient();

  nockAuthCall({
    authClient,
    path: '/oauth/token',
    responseStatus: 200,
    responseBody: {
      access_token: 'access-token',
      token_type: 'bearer',
      expires_in: 100,
      refresh_token: 'refresh-token',
    },
  });

  const requestStartTime = Math.floor(Date.now() / 1000);
  const {
    accessToken,
    refreshToken,
    expirationTime,
    username,
  } = await authClient.refreshAccessToken('refresh-token');
  const requestEndTime = Math.floor(Date.now() / 1000);

  t.is(accessToken, 'access-token');
  t.is(refreshToken, 'refresh-token');
  t.true(expirationTime >= requestStartTime + 100);
  t.true(expirationTime <= requestEndTime + 100);
  t.is(username, undefined);
});
