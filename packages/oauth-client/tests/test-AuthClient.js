const cryptoRandomString = require('crypto-random-string');
const nock = require('nock');
const test = require('ava');
// import { URL, URLSearchParams } from 'url';

const { AuthClient } = require('../dist/src');

const randomString = () => cryptoRandomString({ length: 6 });

const randomId = (prefix, separator = '-') =>
  [prefix, randomString()].filter((x) => x).join(separator);

const randomUrl = () => `http://${randomString()}.local`;

const buildAuthClient = () =>
  new AuthClient({
    clientId: randomId('client-id'),
    clientPassword: randomId('client-password'),
    loginUrl: randomUrl(),
    redirectUri: randomUrl(),
  });

// const nockCognitoCall = (
//   params: {
//     cognitoClient: CognitoClient,
//     path: string,
//     requestBody?: nock.RequestBodyMatcher,
//     requestHeaders?: Record<string, nock.RequestHeaderMatcher>,
//     responseStatus: number,
//     responseBody?: nock.Body
//   }
// ) => {
//   const {
//     cognitoClient,
//     path,
//     requestBody,
//     requestHeaders = {},
//     responseStatus,
//     responseBody,
//   } = params;

//   return nock(
//     cognitoClient.cognitocognitoLoginUrl,
//     { reqheaders: requestHeaders }
//   )
//     .post(path, requestBody)
//     .basicAuth({
//       user: cognitoClient.clientId,
//       pass: cognitoClient.clientPassword,
//     })
//     .reply(responseStatus, responseBody);
// };

test.before(() => {
  nock.disableNetConnect();
});

test('The AuthClient constructor throws a TypeError if clientId is not specified', (t) => {
  t.throws(
    () => {
      new AuthClient({
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

test('The AuthClient constructor throws a TypeError if clientPassword is not specified', (t) => {
  t.throws(
    () => {
      new AuthClient({
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

test('The AuthClient constructor throws a TypeError if loginUrl is not specified', (t) => {
  t.throws(
    () => {
      new AuthClient({
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

test('The AuthClient constructor throws a TypeError if earthdataLoginUrl is not a valid URL', (t) => {
  t.throws(
    () => {
      new AuthClient({
        clientId: 'client-id',
        clientPassword: 'client-password',
        loginUrl: 'asdf',
        redirectUri: 'http://www.example.com/cb',
      });
    },
    { instanceOf: TypeError }
  );
});

test('The AuthClient constructor throws a TypeError if redirectUri is not specified', (t) => {
  t.throws(
    () => {
      new AuthClient({
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

test('The AuthClient constructor throws a TypeError if redirectUri is not a valid URL', (t) => {
  t.throws(
    () => {
      new AuthClient({
        clientId: 'client-id',
        clientPassword: 'client-password',
        loginUrl: 'http://www.example.com',
        redirectUri: 'asdf',
      });
    },
    { instanceOf: TypeError }
  );
});

test('AuthClient.getAuthorizationUrl() returns the correct URL when no state is specified', (t) => {
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

test('EarthdataLogin.getAuthorizationUrl() returns the correct URL when a state is specified', (t) => {
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
