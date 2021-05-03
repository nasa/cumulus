const nock = require('nock');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { CognitoClient, CognitoError } = require('../dist/src');

const randomString = () => cryptoRandomString({ length: 6 });

const randomId = (prefix, separator = '-') =>
  [prefix, randomString()].filter((x) => x).join(separator);

const randomUrl = () => `http://${randomString()}.local`;

const buildCognitoClient = () =>
  new CognitoClient({
    clientId: randomId('client-id'),
    clientPassword: randomId('client-password'),
    cognitoLoginUrl: randomUrl(),
    redirectUri: randomUrl(),
  });

const nockCognitoCall = (params) => {
  const {
    cognitoClient,
    path,
    requestHeaders = {},
    responseStatus,
    responseBody,
  } = params;

  return nock(
    cognitoClient.cognitoLoginUrl,
    { reqheaders: requestHeaders }
  )
    .get(path)
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
        cognitoLoginUrl: 'http://www.example.com',
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
        cognitoLoginUrl: 'http://www.example.com',
        redirectUri: 'http://www.example.com/cb',
      });
    },
    {
      instanceOf: TypeError,
      message: 'clientPassword is required',
    }
  );
});

test('The CognitoClient constructor throws a TypeError if cognitoLoginUrl is not specified', (t) => {
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
      message: 'cognitoLoginUrl is required',
    }
  );
});

test('The CognitoClient constructor throws a TypeError if cognitoLoginUrl is not a valid URL', (t) => {
  t.throws(
    () => {
      new CognitoClient({
        clientId: 'client-id',
        clientPassword: 'client-password',
        cognitoLoginUrl: 'asdf',
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
        cognitoLoginUrl: 'http://www.example.com',
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
        cognitoLoginUrl: 'http://www.example.com',
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

  nockCognitoCall({
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

  nockCognitoCall({
    cognitoClient,
    path: '/oauth/userInfo',
    requestHeaders: { Authorization: `Bearer ${accessToken}` },
    responseStatus: 401,
    responseBody: {
      error: 'invalid_token',
      error_description: 'Access token is not in correct format',
    },
  });

  await t.throwsAsync(
    cognitoClient.getUserInfo(accessToken),
    {
      instanceOf: CognitoError,
      code: 'InvalidToken',
    }
  );
});

test('CognitoClient.getUserInfo() throws an exception for an expired token', async (t) => {
  const cognitoClient = buildCognitoClient();

  const accessToken = randomString();

  nockCognitoCall({
    cognitoClient,
    path: '/oauth/userInfo',
    requestHeaders: { Authorization: `Bearer ${accessToken}` },
    responseStatus: 401,
    responseBody: {
      error: 'invalid_token',
      error_description: 'Access token is expired or user has globally signed out, disabled or been deleted.',
    },
  });

  await t.throwsAsync(
    cognitoClient.getUserInfo(accessToken),
    {
      instanceOf: CognitoError,
      code: 'InvalidToken',
    }
  );
});

test('CognitoClient.getUserInfo() throws an exception if Cognito returns 200 with invalid JSON', async (t) => {
  const cognitoClient = buildCognitoClient();

  const accessToken = randomString();

  nockCognitoCall({
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

  nockCognitoCall({
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
    }
  );
});

test('CognitoClient.getUserInfo() throws an exception if Cognito returns an unexpected error', async (t) => {
  const cognitoClient = buildCognitoClient();

  const accessToken = randomString();

  nockCognitoCall({
    cognitoClient,
    path: '/oauth/userInfo',
    requestHeaders: { Authorization: `Bearer ${accessToken}` },
    responseStatus: 401,
    responseBody: {
      error: 'something_unexpected',
      error_description: 'Something unexpected',
    },
  });

  await t.throwsAsync(
    cognitoClient.getUserInfo(accessToken),
    {
      instanceOf: CognitoError,
      code: 'UnexpectedResponse',
    }
  );
});
