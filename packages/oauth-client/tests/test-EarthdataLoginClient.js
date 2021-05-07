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

test.before(() => {
  nock.disableNetConnect();
});

test('The EarthdataLogin constructor throws a TypeError if clientId is not specified', (t) => {
  t.throws(
    () => {
      new EarthdataLoginClient({
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

test('The EarthdataLogin constructor throws a TypeError if clientPassword is not specified', (t) => {
  t.throws(
    () => {
      new EarthdataLoginClient({
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

test('The EarthdataLogin constructor throws a TypeError if loginUrl is not specified', (t) => {
  t.throws(
    () => {
      new EarthdataLoginClient({
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

test('The EarthdataLogin constructor throws a TypeError if loginUrl is not a valid URL', (t) => {
  t.throws(
    () => {
      new EarthdataLoginClient({
        clientId: 'client-id',
        clientPassword: 'client-password',
        loginUrl: 'asdf',
        redirectUri: 'http://www.example.com/cb',
      });
    },
    { instanceOf: TypeError }
  );
});

test('The EarthdataLogin constructor throws a TypeError if redirectUri is not specified', (t) => {
  t.throws(
    () => {
      new EarthdataLoginClient({
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

test('The EarthdataLogin constructor throws a TypeError if redirectUri is not a valid URL', (t) => {
  t.throws(
    () => {
      new EarthdataLoginClient({
        clientId: 'client-id',
        clientPassword: 'client-password',
        loginUrl: 'http://www.example.com',
        redirectUri: 'asdf',
      });
    },
    { instanceOf: TypeError }
  );
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
