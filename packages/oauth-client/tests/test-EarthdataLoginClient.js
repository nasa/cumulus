const cryptoRandomString = require('crypto-random-string');
const nock = require('nock');
const test = require('ava');

const { EarthdataLoginClient, EarthdataLoginError } = require('../dist');

const randomString = () => cryptoRandomString({ length: 6 });

const randomId = (prefix, separator = '-') =>
  [prefix, randomString()].filter((x) => x).join(separator);

const randomUrl = () => `http://${randomString()}.local`;

const buildEarthdataLoginClient = () =>
  new EarthdataLoginClient({
    clientId: randomId('client-id'),
    clientPassword: randomId('client-password'),
    loginUrl: randomUrl(),
    redirectUri: randomUrl(),
  });

const nockEarthdataLoginCall = (params) => {
  const {
    earthdataLoginClient,
    path,
    requestBody,
    requestHeaders = {},
    responseStatus,
    responseBody,
  } = params;

  return nock(
    earthdataLoginClient.loginUrl,
    { reqheaders: requestHeaders }
  )
    .post(path, requestBody)
    .basicAuth({
      user: earthdataLoginClient.clientId,
      pass: earthdataLoginClient.clientPassword,
    })
    .reply(responseStatus, responseBody);
};

const nockEarthdataLoginGet = (params) => {
  const {
    earthdataLoginClient,
    path,
    requestHeaders = {},
    responseStatus,
    responseBody,
  } = params;

  return nock(
    earthdataLoginClient.loginUrl,
    { reqheaders: requestHeaders }
  )
    .get(path)
    .query({ client_id: earthdataLoginClient.clientId })
    .reply(responseStatus, responseBody);
};

test.before(() => {
  nock.disableNetConnect();
});

test('EarthdataLogin.getTokenUsername() returns the username associated with a valid token', async (t) => {
  const earthdataLoginClient = buildEarthdataLoginClient();

  const expectedUsername = randomId('valid-username');
  const token = randomId('valid-token');
  const onBehalfOf = randomId('on-behalf-of');

  nockEarthdataLoginCall({
    earthdataLoginClient,
    path: '/oauth/tokens/user',
    requestBody: {
      token,
      client_id: earthdataLoginClient.clientId,
      on_behalf_of: onBehalfOf,
    },
    responseStatus: 200,
    responseBody: { uid: expectedUsername },
  });

  const username = await earthdataLoginClient.getTokenUsername({
    token,
    onBehalfOf,
  });

  t.is(username, expectedUsername);
});

test('EarthdataLogin.getTokenUsername() throws an exception for an invalid token', async (t) => {
  const earthdataLoginClient = buildEarthdataLoginClient();

  const token = randomId('invalid-token');
  const onBehalfOf = randomId('on-behalf-of');

  nockEarthdataLoginCall({
    earthdataLoginClient,
    path: '/oauth/tokens/user',
    requestBody: {
      token,
      client_id: earthdataLoginClient.clientId,
      on_behalf_of: onBehalfOf,
    },
    responseStatus: 403,
    responseBody: {
      error: 'invalid_token',
      error_description: 'The token is either malformed or does not exist',
    },
  });

  await t.throwsAsync(
    earthdataLoginClient.getTokenUsername({
      token,
      onBehalfOf,
    }),
    {
      instanceOf: EarthdataLoginError,
      code: 'InvalidToken',
    }
  );
});

test('EarthdataLogin.getTokenUsername() throws an exception for an expired token', async (t) => {
  const earthdataLoginClient = buildEarthdataLoginClient();

  const token = randomId('expired-token');
  const onBehalfOf = randomId('on-behalf-of');

  nockEarthdataLoginCall({
    earthdataLoginClient,
    path: '/oauth/tokens/user',
    requestBody: {
      token,
      client_id: earthdataLoginClient.clientId,
      on_behalf_of: onBehalfOf,
    },
    responseStatus: 403,
    responseBody: {
      error: 'token_expired',
      error_description: 'The token has expired',
    },
  });

  await t.throwsAsync(
    earthdataLoginClient.getTokenUsername({
      token,
      onBehalfOf,
    }),
    {
      instanceOf: EarthdataLoginError,
      code: 'TokenExpired',
    }
  );
});

test('EarthdataLogin.getTokenUsername() throws an exception if EarthdataLogin returns 200 with invalid JSON', async (t) => {
  const earthdataLoginClient = buildEarthdataLoginClient();

  const token = randomId('invalid-json-200-token');
  const onBehalfOf = randomId('on-behalf-of');

  nockEarthdataLoginCall({
    earthdataLoginClient,
    path: '/oauth/tokens/user',
    requestBody: {
      token,
      client_id: earthdataLoginClient.clientId,
      on_behalf_of: onBehalfOf,
    },
    responseStatus: 200,
    responseBody: 'asdf',
  });

  await t.throwsAsync(
    earthdataLoginClient.getTokenUsername({
      token,
      onBehalfOf,
    }),
    {
      instanceOf: EarthdataLoginError,
      code: 'InvalidResponse',
    }
  );
});

test('EarthdataLogin.getTokenUsername() throws an exception if EarthdataLogin returns 403 with invalid JSON', async (t) => {
  const earthdataLoginClient = buildEarthdataLoginClient();

  const token = randomId('invalid-json-403-token');
  const onBehalfOf = randomId('on-behalf-of');

  nockEarthdataLoginCall({
    earthdataLoginClient,
    path: '/oauth/tokens/user',
    requestBody: {
      token,
      client_id: earthdataLoginClient.clientId,
      on_behalf_of: onBehalfOf,
    },
    responseStatus: 403,
    responseBody: 'asdf',
  });

  await t.throwsAsync(
    earthdataLoginClient.getTokenUsername({
      token,
      onBehalfOf,
    }),
    {
      instanceOf: EarthdataLoginError,
      code: 'UnexpectedResponse',
    }
  );
});

test('EarthdataLogin.getTokenUsername() throws an exception if EarthdataLogin returns an unexpected error', async (t) => {
  const earthdataLoginClient = buildEarthdataLoginClient();

  const token = randomId('unexpected-error-token');
  const onBehalfOf = randomId('on-behalf-of');

  nockEarthdataLoginCall({
    earthdataLoginClient,
    path: '/oauth/tokens/user',
    requestBody: {
      token,
      client_id: earthdataLoginClient.clientId,
      on_behalf_of: onBehalfOf,
    },
    responseStatus: 403,
    responseBody: {
      error: 'something_unexpected',
      error_description: 'Something unexpected',
    },
  });

  await t.throwsAsync(
    earthdataLoginClient.getTokenUsername({ token, onBehalfOf }),
    {
      instanceOf: EarthdataLoginError,
      code: 'UnexpectedResponse',
    }
  );
});

test('EarthdataLogin.getTokenUsername() forwards the X-Request-Id if present', async (t) => {
  const earthdataLoginClient = buildEarthdataLoginClient();

  const expectedUsername = randomId('valid-username');
  const token = randomId('valid-token');
  const onBehalfOf = randomId('on-behalf-of');
  const xRequestId = randomId('x-request-id');

  const nockScope = nockEarthdataLoginCall({
    earthdataLoginClient,
    path: '/oauth/tokens/user',
    requestHeaders: { 'X-Request-Id': xRequestId },
    requestBody: {
      token,
      client_id: earthdataLoginClient.clientId,
      on_behalf_of: onBehalfOf,
    },
    responseStatus: 200,
    responseBody: { uid: expectedUsername },
  });
  await earthdataLoginClient.getTokenUsername({
    token,
    onBehalfOf,
    xRequestId,
  });

  t.true(nockScope.isDone());
});

test('EarthdataLogin.getAccessToken() throws an EarthdataLoginError for a 400 response', async (t) => {
  const earthdataLoginClient = buildEarthdataLoginClient();

  const accessToken = randomString();

  nockEarthdataLoginCall({
    earthdataLoginClient,
    path: '/oauth/token',
    responseStatus: 400,
    responseBody: {
      error: 'UnauthorizedException',
      error_description: 'Invalid client credentials',
    },
  });

  await t.throwsAsync(
    earthdataLoginClient.getAccessToken(accessToken),
    {
      instanceOf: EarthdataLoginError,
      code: 'BadRequest',
    }
  );
});

test('EarthdataLogin.getAccessToken() throws an EarthdataLoginError for a 401 response', async (t) => {
  const earthdataLoginClient = buildEarthdataLoginClient();

  const accessToken = randomString();

  nockEarthdataLoginCall({
    earthdataLoginClient,
    path: '/oauth/token',
    responseStatus: 401,
    responseBody: {
      error: 'UnauthorizedException',
      error_description: 'Invalid client credentials',
    },
  });

  await t.throwsAsync(
    earthdataLoginClient.getAccessToken(accessToken),
    {
      instanceOf: EarthdataLoginError,
      code: 'UnexpectedResponse',
    }
  );
});

test('EarthdataLogin.refreshAccessToken() throws an EarthdataLoginError for a 400 response', async (t) => {
  const earthdataLoginClient = buildEarthdataLoginClient();

  const accessToken = randomString();

  nockEarthdataLoginCall({
    earthdataLoginClient,
    path: '/oauth/token',
    responseStatus: 400,
    responseBody: {
      error: 'UnauthorizedException',
      error_description: 'Invalid client credentials',
    },
  });

  await t.throwsAsync(
    earthdataLoginClient.refreshAccessToken(accessToken),
    {
      instanceOf: EarthdataLoginError,
      code: 'BadRequest',
    }
  );
});

test('EarthdataLogin.refreshAccessToken() throws an EarthdataLoginError for a 401 response', async (t) => {
  const earthdataLoginClient = buildEarthdataLoginClient();

  const accessToken = randomString();

  nockEarthdataLoginCall({
    earthdataLoginClient,
    path: '/oauth/token',
    responseStatus: 401,
    responseBody: {
      error: 'UnauthorizedException',
      error_description: 'Invalid client credentials',
    },
  });

  await t.throwsAsync(
    earthdataLoginClient.refreshAccessToken(accessToken),
    {
      instanceOf: EarthdataLoginError,
      code: 'UnexpectedResponse',
    }
  );
});

test('EarthdataLogin.getUserInfo() returns the user info associated with a valid access token', async (t) => {
  const earthdataLoginClient = buildEarthdataLoginClient();

  const expectedUsername = randomId('valid-username');
  const givenName = randomString();
  const familyName = randomString();
  const affiliation = randomString();
  const email = randomString();
  const token = randomString();
  const username = randomId('username');

  const expectedUserInfo = {
    uid: expectedUsername,
    first_name: givenName,
    last_name: familyName,
    affiliation,
    email_address: email,
  };

  nockEarthdataLoginGet({
    earthdataLoginClient,
    path: `/api/users/${username}`,
    requestHeaders: { Authorization: `Bearer ${token}` },
    responseStatus: 200,
    responseBody: expectedUserInfo,
  });

  const userInfo = await earthdataLoginClient.getUserInfo({ token, username });

  t.deepEqual(userInfo, expectedUserInfo);
});

test('EarthdataLogin.getUserInfo() throws error if access token is missing', async (t) => {
  const earthdataLoginClient = buildEarthdataLoginClient();

  await t.throwsAsync(
    earthdataLoginClient.getUserInfo(),
    {
      instanceOf: TypeError,
      message: 'token and username are required',
    }
  );
});

test('EarthdataLogin.getUserInfo() throws an exception for an invalid token', async (t) => {
  const earthdataLoginClient = buildEarthdataLoginClient();

  const token = randomString();
  const username = randomId('username');

  nockEarthdataLoginGet({
    earthdataLoginClient,
    path: `/api/users/${username}`,
    requestHeaders: { Authorization: `Bearer ${token}` },
    responseStatus: 401,
    responseBody: {
      error: 'invalid_token',
      error_description: 'Access token is not in correct format',
    },
  });

  await t.throwsAsync(
    earthdataLoginClient.getUserInfo({ token, username }),
    {
      instanceOf: EarthdataLoginError,
      code: 'InvalidToken',
      message: 'Invalid token',
    }
  );
});

test('EarthdataLogin.getUserInfo() throws an exception for an expired token', async (t) => {
  const earthdataLoginClient = buildEarthdataLoginClient();

  const token = randomString();
  const username = randomId('username');

  nockEarthdataLoginGet({
    earthdataLoginClient,
    path: `/api/users/${username}`,
    requestHeaders: { Authorization: `Bearer ${token}` },
    responseStatus: 401,
    responseBody: {
      error: 'token_expired',
      error_description: 'Access token is expired or user has globally signed out, disabled or been deleted.',
    },
  });

  await t.throwsAsync(
    earthdataLoginClient.getUserInfo({ token, username }),
    {
      instanceOf: EarthdataLoginError,
      code: 'TokenExpired',
      message: 'The token has expired',
    }
  );
});

test('EarthdataLogin.getUserInfo() throws an exception if EarthdataLogin returns 200 with invalid JSON', async (t) => {
  const earthdataLoginClient = buildEarthdataLoginClient();
  const token = randomString();
  const username = randomId('username');

  nockEarthdataLoginGet({
    earthdataLoginClient,
    path: `/api/users/${username}`,
    requestHeaders: { Authorization: `Bearer ${token}` },
    responseStatus: 200,
    responseBody: 'asdf',
  });

  await t.throwsAsync(
    earthdataLoginClient.getUserInfo({ token, username }),
    {
      instanceOf: EarthdataLoginError,
      code: 'InvalidResponse',
    }
  );
});

test('EarthdataLogin.getUserInfo() throws an exception if EarthdataLogin returns 401 with invalid JSON', async (t) => {
  const earthdataLoginClient = buildEarthdataLoginClient();
  const token = randomString();
  const username = randomId('username');

  nockEarthdataLoginGet({
    earthdataLoginClient,
    path: `/api/users/${username}`,
    requestHeaders: { Authorization: `Bearer ${token}` },
    responseStatus: 401,
    responseBody: 'asdf',
  });

  await t.throwsAsync(
    earthdataLoginClient.getUserInfo({ token, username }),
    {
      instanceOf: EarthdataLoginError,
      code: 'UnexpectedResponse',
      message: 'Unexpected response: "asdf"',
    }
  );
});

test('EarthdataLogin.getUserInfo() throws an exception if EarthdataLogin returns an unexpected error', async (t) => {
  const earthdataLoginClient = buildEarthdataLoginClient();
  const token = randomString();
  const username = randomId('username');

  nockEarthdataLoginGet({
    earthdataLoginClient,
    path: `/api/users/${username}`,
    requestHeaders: { Authorization: `Bearer ${token}` },
    responseStatus: 401,
    responseBody: {
      error: 'SomethingUnexpected',
      error_description: 'Something unexpected',
    },
  });

  await t.throwsAsync(
    earthdataLoginClient.getUserInfo({ token, username }),
    {
      instanceOf: EarthdataLoginError,
      code: 'UnexpectedResponse',
      message: /Unexpected response: /,
    }
  );
});
