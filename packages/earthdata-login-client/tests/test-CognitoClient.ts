// import cryptoRandomString from 'crypto-random-string';
import nock from 'nock';
import test from 'ava';
// import { URL, URLSearchParams } from 'url';

import {
  CognitoClient,
} from '../src';

// const randomString = () => cryptoRandomString({ length: 6 });

// const randomId = (prefix: string, separator = '-') =>
//   [prefix, randomString()].filter((x) => x).join(separator);

// const randomUrl = () => `http://${randomString()}.local`;

// const buildCognitoClient = () =>
//   new CognitoClient({
//     clientId: randomId('client-id'),
//     clientPassword: randomId('client-password'),
//     cognitoLoginUrl: randomUrl(),
//     redirectUri: randomUrl(),
//   });

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

test('The CognitoClient constructor throws a TypeError if clientId is not specified', (t) => {
  t.throws(
    () => {
      // @ts-expect-error
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
    // @ts-expect-error
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
    // @ts-expect-error
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
    // @ts-expect-error
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

// test('EarthdataLogin.getAuthorizationUrl() returns the correct URL when no state is specified', (t) => {
//   const earthdataLoginClient = buildEarthdataLoginClient();

//   const authorizationUrl = earthdataLoginClient.getAuthorizationUrl();
//   const parsedAuthorizationUrl = new URL(authorizationUrl);

//   t.is(parsedAuthorizationUrl.origin, earthdataLoginClient.earthdatacognitoLoginUrl);
//   t.is(parsedAuthorizationUrl.pathname, '/oauth/authorize');
//   t.is(parsedAuthorizationUrl.searchParams.get('response_type'), 'code');
//   t.is(parsedAuthorizationUrl.searchParams.get('client_id'), earthdataLoginClient.clientId);
//   t.is(parsedAuthorizationUrl.searchParams.get('redirect_uri'), earthdataLoginClient.redirectUri);
//   t.false(parsedAuthorizationUrl.searchParams.has('state'));
// });

// test('EarthdataLogin.getAuthorizationUrl() returns the correct URL when a state is specified', (t) => {
//   const earthdataLoginClient = buildEarthdataLoginClient();

//   const authorizationUrl = earthdataLoginClient.getAuthorizationUrl('the-state');
//   const parsedAuthorizationUrl = new URL(authorizationUrl);

//   t.is(parsedAuthorizationUrl.origin, earthdataLoginClient.earthdatacognitoLoginUrl);
//   t.is(parsedAuthorizationUrl.pathname, '/oauth/authorize');
//   t.is(parsedAuthorizationUrl.searchParams.get('response_type'), 'code');
//   t.is(parsedAuthorizationUrl.searchParams.get('client_id'), earthdataLoginClient.clientId);
//   t.is(parsedAuthorizationUrl.searchParams.get('redirect_uri'), earthdataLoginClient.redirectUri);
//   t.is(parsedAuthorizationUrl.searchParams.get('state'), 'the-state');
// });

// test('EarthdataLogin.getAccessToken() throws a TypeError if authorizationCode is not set', async (t) => {
//   const earthdataLoginClient = buildEarthdataLoginClient();

//   await t.throwsAsync(
//     // @ts-expect-error
//     () => earthdataLoginClient.getAccessToken(),
//     {
//       instanceOf: TypeError,
//       message: 'authorizationCode is required',
//     }
//   );
// });

// test('EarthdataLogin.getAccessToken() sends a correct request to the token endpoint', async (t) => {
//   const earthdataLoginClient = buildEarthdataLoginClient();

//   nock(
//     earthdataLoginClient.earthdatacognitoLoginUrl,
//     {
//       reqheaders: {
//         'content-type': 'application/x-www-form-urlencoded',
//       },
//     }
//   )
//     .post(
//       '/oauth/token',
//       (body) => {
//         const parsedBody = new URLSearchParams(body);

//         return parsedBody.get('grant_type') === 'authorization_code'
//           && parsedBody.get('code') === 'authorization-code'
//           && parsedBody.get('redirect_uri') === earthdataLoginClient.redirectUri;
//       }
//     )
//     .basicAuth({
//       user: earthdataLoginClient.clientId,
//       pass: earthdataLoginClient.clientPassword,
//     })
//     .reply(
//       200,
//       {
//         access_token: 'access-token',
//         token_type: 'bearer',
//         expires_in: 123,
//         refresh_token: 'refresh-token',
//         endpoint: '/api/users/sidney',
//       }
//     );

//   await earthdataLoginClient.getAccessToken('authorization-code');

//   t.pass();
// });

// test('EarthdataLogin.getAccessToken() returns token information for a valid authorizationCode', async (t) => {
//   const earthdataLoginClient = buildEarthdataLoginClient();

//   nockEarthdataLoginCall({
//     earthdataLoginClient,
//     path: '/oauth/token',
//     responseStatus: 200,
//     responseBody: {
//       access_token: 'access-token',
//       token_type: 'bearer',
//       expires_in: 100,
//       refresh_token: 'refresh-token',
//       endpoint: '/api/users/sidney',
//     },
//   });

//   const requestStartTime = Math.floor(Date.now() / 1000);
//   const {
//     accessToken,
//     refreshToken,
//     expirationTime,
//     username,
//   } = await earthdataLoginClient.getAccessToken('authorization-code');
//   const requestEndTime = Math.floor(Date.now() / 1000);

//   t.is(accessToken, 'access-token');
//   t.is(refreshToken, 'refresh-token');
//   t.true(expirationTime >= requestStartTime + 100);
//   t.true(expirationTime <= requestEndTime + 100);
//   t.is(username, 'sidney');
// });

// test('EarthdataLogin.getAccessToken() throws an EarthdataLoginError error for an invalid authorizationCode', async (t) => {
//   const earthdataLoginClient = buildEarthdataLoginClient();

//   nockEarthdataLoginCall({
//     earthdataLoginClient,
//     path: '/oauth/token',
//     responseStatus: 400,
//   });

//   await t.throwsAsync(
//     () => earthdataLoginClient.getAccessToken('authorization-code'),
//     { instanceOf: EarthdataLoginError }
//   );
// });

// test('EarthdataLogin.getAccessToken() throws an EarthdataLoginError error if there is a problem with the Earthdata Login service', async (t) => {
//   const earthdataLoginClient = buildEarthdataLoginClient();

//   nockEarthdataLoginCall({
//     earthdataLoginClient,
//     path: '/oauth/token',
//     responseStatus: 500,
//   });

//   await t.throwsAsync(
//     () => earthdataLoginClient.getAccessToken('authorization-code'),
//     { instanceOf: EarthdataLoginError }
//   );
// });

// test('EarthdataLogin.refreshAccessToken() throws a TypeError if refreshToken is not set', async (t) => {
//   const earthdataLoginClient = buildEarthdataLoginClient();

//   await t.throwsAsync(
//     // @ts-expect-error
//     () => earthdataLoginClient.refreshAccessToken(),
//     {
//       instanceOf: TypeError,
//       message: 'refreshToken is required',
//     }
//   );
// });

// test('EarthdataLogin.refreshAccessToken() sends a correct request to the token endpoint', async (t) => {
//   const earthdataLoginClient = buildEarthdataLoginClient();

//   nock(
//     earthdataLoginClient.earthdatacognitoLoginUrl,
//     {
//       reqheaders: {
//         'content-type': 'application/x-www-form-urlencoded',
//       },
//     }
//   )
//     .post(
//       '/oauth/token',
//       (body) => {
//         const parsedBody = new URLSearchParams(body);

//         return parsedBody.get('grant_type') === 'refresh_token'
//           && parsedBody.get('refresh_token') === 'refresh-token';
//       }
//     )
//     .basicAuth({
//       user: earthdataLoginClient.clientId,
//       pass: earthdataLoginClient.clientPassword,
//     })
//     .reply(
//       200,
//       {
//         access_token: 'access-token',
//         token_type: 'bearer',
//         expires_in: 123,
//         refresh_token: 'refresh-token',
//         endpoint: '/api/users/sidney',
//       }
//     );

//   await earthdataLoginClient.refreshAccessToken('refresh-token');

//   t.pass();
// });

// test('EarthdataLogin.refreshAccessToken() returns token information for a valid refreshToken', async (t) => {
//   const earthdataLoginClient = buildEarthdataLoginClient();

//   nockEarthdataLoginCall({
//     earthdataLoginClient,
//     path: '/oauth/token',
//     responseStatus: 200,
//     responseBody: {
//       access_token: 'access-token',
//       token_type: 'bearer',
//       expires_in: 100,
//       refresh_token: 'refresh-token',
//       endpoint: '/api/users/sidney',
//     },
//   });

//   const requestStartTime = Math.floor(Date.now() / 1000);
//   const {
//     accessToken,
//     refreshToken,
//     expirationTime,
//     username,
//   } = await earthdataLoginClient.refreshAccessToken('refresh-token');
//   const requestEndTime = Math.floor(Date.now() / 1000);

//   t.is(accessToken, 'access-token');
//   t.is(refreshToken, 'refresh-token');
//   t.true(expirationTime >= requestStartTime + 100);
//   t.true(expirationTime <= requestEndTime + 100);
//   t.is(username, 'sidney');
// });

// test('EarthdataLogin.refreshAccessToken() throws an EarthdataLoginError error for an invalid refreshToken', async (t) => {
//   const earthdataLoginClient = buildEarthdataLoginClient();

//   nockEarthdataLoginCall({
//     earthdataLoginClient,
//     path: '/oauth/token',
//     responseStatus: 400,
//   });

//   await t.throwsAsync(
//     () => earthdataLoginClient.refreshAccessToken('invalid-refresh-token'),
//     { instanceOf: EarthdataLoginError }
//   );
// });

// test('EarthdataLogin.refreshAccessToken() throws an EarthdataLoginError error if there is a problem with the Earthdata Login service', async (t) => {
//   const earthdataLoginClient = buildEarthdataLoginClient();

//   nockEarthdataLoginCall({
//     earthdataLoginClient,
//     path: '/oauth/token',
//     responseStatus: 500,
//   });

//   await t.throwsAsync(
//     () => earthdataLoginClient.refreshAccessToken('refresh-token'),
//     { instanceOf: EarthdataLoginError }
//   );
// });

// test('EarthdataLogin.getTokenUsername() returns the username associated with a valid token', async (t) => {
//   const earthdataLoginClient = buildEarthdataLoginClient();

//   const expectedUsername = randomId('valid-username');
//   const token = randomId('valid-token');
//   const onBehalfOf = randomId('on-behalf-of');

//   nockEarthdataLoginCall({
//     earthdataLoginClient,
//     path: '/oauth/tokens/user',
//     requestBody: {
//       token,
//       client_id: earthdataLoginClient.clientId,
//       on_behalf_of: onBehalfOf,
//     },
//     responseStatus: 200,
//     responseBody: { uid: expectedUsername },
//   });

//   const username = await earthdataLoginClient.getTokenUsername({
//     token,
//     onBehalfOf,
//   });

//   t.is(username, expectedUsername);
// });

// test('EarthdataLogin.getTokenUsername() throws an exception for an invalid token', async (t) => {
//   const earthdataLoginClient = buildEarthdataLoginClient();

//   const token = randomId('invalid-token');
//   const onBehalfOf = randomId('on-behalf-of');

//   nockEarthdataLoginCall({
//     earthdataLoginClient,
//     path: '/oauth/tokens/user',
//     requestBody: {
//       token,
//       client_id: earthdataLoginClient.clientId,
//       on_behalf_of: onBehalfOf,
//     },
//     responseStatus: 403,
//     responseBody: {
//       error: 'invalid_token',
//       error_description: 'The token is either malformed or does not exist',
//     },
//   });

//   await t.throwsAsync(
//     earthdataLoginClient.getTokenUsername({
//       token,
//       onBehalfOf,
//     }),
//     {
//       instanceOf: EarthdataLoginError,
//       code: 'InvalidToken',
//     }
//   );
// });

// test('EarthdataLogin.getTokenUsername() throws an exception for an expired token', async (t) => {
//   const earthdataLoginClient = buildEarthdataLoginClient();

//   const token = randomId('expired-token');
//   const onBehalfOf = randomId('on-behalf-of');

//   nockEarthdataLoginCall({
//     earthdataLoginClient,
//     path: '/oauth/tokens/user',
//     requestBody: {
//       token,
//       client_id: earthdataLoginClient.clientId,
//       on_behalf_of: onBehalfOf,
//     },
//     responseStatus: 403,
//     responseBody: {
//       error: 'token_expired',
//       error_description: 'The token has expired',
//     },
//   });

//   await t.throwsAsync(
//     earthdataLoginClient.getTokenUsername({
//       token,
//       onBehalfOf,
//     }),
//     {
//       instanceOf: EarthdataLoginError,
//       code: 'TokenExpired',
//     }
//   );
// });

// test('EarthdataLogin.getTokenUsername() throws an exception if EarthdataLogin returns 200 with invalid JSON', async (t) => {
//   const earthdataLoginClient = buildEarthdataLoginClient();

//   const token = randomId('invalid-json-200-token');
//   const onBehalfOf = randomId('on-behalf-of');

//   nockEarthdataLoginCall({
//     earthdataLoginClient,
//     path: '/oauth/tokens/user',
//     requestBody: {
//       token,
//       client_id: earthdataLoginClient.clientId,
//       on_behalf_of: onBehalfOf,
//     },
//     responseStatus: 200,
//     responseBody: 'asdf',
//   });

//   await t.throwsAsync(
//     earthdataLoginClient.getTokenUsername({
//       token,
//       onBehalfOf,
//     }),
//     {
//       instanceOf: EarthdataLoginError,
//       code: 'InvalidResponse',
//     }
//   );
// });

// test('EarthdataLogin.getTokenUsername() throws an exception if EarthdataLogin returns 403 with invalid JSON', async (t) => {
//   const earthdataLoginClient = buildEarthdataLoginClient();

//   const token = randomId('invalid-json-403-token');
//   const onBehalfOf = randomId('on-behalf-of');

//   nockEarthdataLoginCall({
//     earthdataLoginClient,
//     path: '/oauth/tokens/user',
//     requestBody: {
//       token,
//       client_id: earthdataLoginClient.clientId,
//       on_behalf_of: onBehalfOf,
//     },
//     responseStatus: 403,
//     responseBody: 'asdf',
//   });

//   await t.throwsAsync(
//     earthdataLoginClient.getTokenUsername({
//       token,
//       onBehalfOf,
//     }),
//     {
//       instanceOf: EarthdataLoginError,
//       code: 'UnexpectedResponse',
//     }
//   );
// });

// test('EarthdataLogin.getTokenUsername() throws an exception if EarthdataLogin returns an unexpected error', async (t) => {
//   const earthdataLoginClient = buildEarthdataLoginClient();

//   const token = randomId('unexpected-error-token');
//   const onBehalfOf = randomId('on-behalf-of');

//   nockEarthdataLoginCall({
//     earthdataLoginClient,
//     path: '/oauth/tokens/user',
//     requestBody: {
//       token,
//       client_id: earthdataLoginClient.clientId,
//       on_behalf_of: onBehalfOf,
//     },
//     responseStatus: 403,
//     responseBody: {
//       error: 'something_unexpected',
//       error_description: 'Something unexpected',
//     },
//   });

//   await t.throwsAsync(
//     earthdataLoginClient.getTokenUsername({ token, onBehalfOf }),
//     {
//       instanceOf: EarthdataLoginError,
//       code: 'UnexpectedResponse',
//     }
//   );
// });

// test('EarthdataLogin.getTokenUsername() forwards the X-Request-Id if present', async (t) => {
//   const earthdataLoginClient = buildEarthdataLoginClient();

//   const expectedUsername = randomId('valid-username');
//   const token = randomId('valid-token');
//   const onBehalfOf = randomId('on-behalf-of');
//   const xRequestId = randomId('x-request-id');

//   const nockScope = nockEarthdataLoginCall({
//     earthdataLoginClient,
//     path: '/oauth/tokens/user',
//     requestHeaders: { 'X-Request-Id': xRequestId },
//     requestBody: {
//       token,
//       client_id: earthdataLoginClient.clientId,
//       on_behalf_of: onBehalfOf,
//     },
//     responseStatus: 200,
//     responseBody: { uid: expectedUsername },
//   });
//   await earthdataLoginClient.getTokenUsername({
//     token,
//     onBehalfOf,
//     xRequestId,
//   });

//   t.true(nockScope.isDone());
// });
