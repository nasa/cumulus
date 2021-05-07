const nock = require('nock');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { CognitoClient, CognitoError } = require('../dist');

const randomString = () => cryptoRandomString({ length: 6 });

const randomId = (prefix, separator = '-') =>
  [prefix, randomString()].filter((x) => x).join(separator);

const randomUrl = () => `http://${randomString()}.local`;

const buildCognitoClient = () =>
  new CognitoClient({
    clientId: randomId('client-id'),
    clientPassword: randomId('client-password'),
    loginUrl: randomUrl(),
    redirectUri: randomUrl(),
  });

const nockCognitoGet = (params) => {
  const {
    cognitoClient,
    path,
    requestHeaders = {},
    responseStatus,
    responseBody,
  } = params;

  return nock(
    cognitoClient.loginUrl,
    { reqheaders: requestHeaders }
  )
    .get(path)
    .reply(responseStatus, responseBody);
};

const nockAuthPost = (params) => {
  const {
    cognitoClient,
    path,
    requestBody,
    requestHeaders = {},
    responseStatus,
    responseBody,
  } = params;

  return nock(
    cognitoClient.loginUrl,
    { reqheaders: requestHeaders }
  )
    .post(path, requestBody)
    .basicAuth({
      user: cognitoClient.clientId,
      pass: cognitoClient.clientPassword,
    })
    .reply(responseStatus, responseBody);
};

test.before(() => {
  nock.disableNetConnect();
});

test('The CognitoClient constructor throws a TypeError if clientId is not specified', (t) => {
  t.throws(
    () => {
      new CognitoClient({
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

test('The CognitoClient constructor throws a TypeError if clientPassword is not specified', (t) => {
  t.throws(
    () => {
      new CognitoClient({
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

test('The CognitoClient constructor throws a TypeError if loginUrl is not specified', (t) => {
  t.throws(
    () => {
      new CognitoClient({
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

test('The CognitoClient constructor throws a TypeError if loginUrl is not a valid URL', (t) => {
  t.throws(
    () => {
      new CognitoClient({
        clientId: 'client-id',
        clientPassword: 'client-password',
        loginUrl: 'asdf',
        redirectUri: 'http://www.example.com/cb',
      });
    },
    { instanceOf: TypeError }
  );
});

test('The CognitoClient constructor throws a TypeError if redirectUri is not specified', (t) => {
  t.throws(
    () => {
      new CognitoClient({
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

test('The CognitoClient constructor throws a TypeError if redirectUri is not a valid URL', (t) => {
  t.throws(
    () => {
      new CognitoClient({
        clientId: 'client-id',
        clientPassword: 'client-password',
        loginUrl: 'http://www.example.com',
        redirectUri: 'asdf',
      });
    },
    { instanceOf: TypeError }
  );
});

test('CognitoClient.getUserInfo() returns the user info associated with a valid access token', async (t) => {
  const cognitoClient = buildCognitoClient();

  const expectedUsername = randomId('valid-username');
  const givenName = randomString();
  const familyName = randomString();
  const studyArea = randomString();
  const organization = randomString();
  const email = randomString();
  const accessToken = randomString();

  const expectedUserInfo = {
    username: expectedUsername,
    given_name: givenName,
    family_name: familyName,
    study_area: studyArea,
    organization,
    email,
  };

  nockCognitoGet({
    cognitoClient,
    path: '/oauth/userInfo',
    requestHeaders: { Authorization: `Bearer ${accessToken}` },
    responseStatus: 200,
    responseBody: expectedUserInfo,
  });

  const userInfo = await cognitoClient.getUserInfo(accessToken);

  t.deepEqual(userInfo, expectedUserInfo);
});

test('CognitoClient.getUserInfo() throws error if access token is missing', async (t) => {
  const cognitoClient = buildCognitoClient();

  await t.throwsAsync(
    cognitoClient.getUserInfo(),
    {
      instanceOf: TypeError,
      message: 'accessToken is required',
    }
  );
});

test('CognitoClient.getUserInfo() throws an exception for an invalid token', async (t) => {
  const cognitoClient = buildCognitoClient();

  const accessToken = randomString();

  nockCognitoGet({
    cognitoClient,
    path: '/oauth/userInfo',
    requestHeaders: { Authorization: `Bearer ${accessToken}` },
    responseStatus: 401,
    responseBody: {
      error: 'InvalidToken',
      error_description: 'Access token is not in correct format',
    },
  });

  await t.throwsAsync(
    cognitoClient.getUserInfo(accessToken),
    {
      instanceOf: CognitoError,
      code: 'InvalidToken',
      message: 'Access token is not in correct format',
    }
  );
});

test('CognitoClient.getUserInfo() throws an exception for an expired token', async (t) => {
  const cognitoClient = buildCognitoClient();

  const accessToken = randomString();

  nockCognitoGet({
    cognitoClient,
    path: '/oauth/userInfo',
    requestHeaders: { Authorization: `Bearer ${accessToken}` },
    responseStatus: 401,
    responseBody: {
      error: 'InvalidToken',
      error_description: 'Access token is expired or user has globally signed out, disabled or been deleted.',
    },
  });

  await t.throwsAsync(
    cognitoClient.getUserInfo(accessToken),
    {
      instanceOf: CognitoError,
      code: 'InvalidToken',
      message: 'Access token is expired or user has globally signed out, disabled or been deleted.',
    }
  );
});

test('CognitoClient.getUserInfo() throws an exception if Cognito returns 200 with invalid JSON', async (t) => {
  const cognitoClient = buildCognitoClient();

  const accessToken = randomString();

  nockCognitoGet({
    cognitoClient,
    path: '/oauth/userInfo',
    requestHeaders: { Authorization: `Bearer ${accessToken}` },
    responseStatus: 200,
    responseBody: 'asdf',
  });

  await t.throwsAsync(
    cognitoClient.getUserInfo(accessToken),
    {
      instanceOf: CognitoError,
      code: 'InvalidResponse',
    }
  );
});

test('CognitoClient.getUserInfo() throws an exception if Cognito returns 401 with invalid JSON', async (t) => {
  const cognitoClient = buildCognitoClient();

  const accessToken = randomString();

  nockCognitoGet({
    cognitoClient,
    path: '/oauth/userInfo',
    requestHeaders: { Authorization: `Bearer ${accessToken}` },
    responseStatus: 401,
    responseBody: 'asdf',
  });

  await t.throwsAsync(
    cognitoClient.getUserInfo(accessToken),
    {
      instanceOf: CognitoError,
      code: 'UnexpectedResponse',
      message: 'Unexpected response: asdf',
    }
  );
});

test('CognitoClient.getUserInfo() throws an exception if Cognito returns an unexpected error', async (t) => {
  const cognitoClient = buildCognitoClient();

  const accessToken = randomString();

  nockCognitoGet({
    cognitoClient,
    path: '/oauth/userInfo',
    requestHeaders: { Authorization: `Bearer ${accessToken}` },
    responseStatus: 401,
    responseBody: {
      error: 'SomethingUnexpected',
      error_description: 'Something unexpected',
    },
  });

  await t.throwsAsync(
    cognitoClient.getUserInfo(accessToken),
    {
      instanceOf: CognitoError,
      code: 'SomethingUnexpected',
      message: 'Something unexpected',
    }
  );
});

test('CognitoClient.getAccessToken() throws a CognitoError with the correct code and message', async (t) => {
  const cognitoClient = buildCognitoClient();

  const authorizationCode = randomString();

  nockAuthPost({
    cognitoClient,
    path: '/oauth/token',
    responseStatus: 401,
    responseBody: {
      error: 'UnauthorizedException',
      error_description: 'Invalid client credentials',
    },
  });

  await t.throwsAsync(
    cognitoClient.getAccessToken(authorizationCode),
    {
      instanceOf: CognitoError,
      code: 'UnauthorizedException',
      message: 'Invalid client credentials',
    }
  );
});

test('CognitoClient.refreshAccessToken() throws a CognitoError with the correct code and message', async (t) => {
  const cognitoClient = buildCognitoClient();

  const refreshToken = randomString();

  nockAuthPost({
    cognitoClient,
    path: '/oauth/token',
    responseStatus: 401,
    responseBody: {
      error: 'UnauthorizedException',
      error_description: 'Invalid client credentials',
    },
  });

  await t.throwsAsync(
    cognitoClient.refreshAccessToken(refreshToken),
    {
      instanceOf: CognitoError,
      code: 'UnauthorizedException',
      message: 'Invalid client credentials',
    }
  );
});
