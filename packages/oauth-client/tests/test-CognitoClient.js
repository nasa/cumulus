const nock = require('nock');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { CognitoClient } = require('../dist/src');

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
