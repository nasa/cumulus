'use strict';

const nock = require('nock');
const test = require('ava');
const EarthdataLogin = require('../EarthdataLogin');

test.before(async (t) => {
  t.context.earthdataLoginEndpoint = 'https://uat.urs.earthdata.nasa.gov';
  t.context.clientId = 'client-id';
  t.context.onBehalfOf = 'on-behalf-of';

  t.context.defaultParams = {
    earthdataLoginEndpoint: t.context.earthdataLoginEndpoint,
    clientId: t.context.clientId,
    onBehalfOf: t.context.onBehalfOf
  };

  t.context.expiredToken = 'expired-token';
  t.context.invalidToken = 'invalid-token';
  t.context.nonJsonResponseToken = 'non-json-response-token';
  t.context.validToken = 'valid-token';
  t.context.validTokenUsername = 'valid-token-username';
  t.context.unexpectedResponseToken = 'unexpected-response-token';

  nock.disableNetConnect();

  const nockInterceptors = [
    {
      token: t.context.invalidToken,
      statusCode: 403,
      body: {
        error: 'invalid_token',
        error_description: 'The token is either malformed or does not exist'
      }
    },
    {
      token: t.context.expiredToken,
      statusCode: 403,
      body: {
        error: 'token_expired',
        error_description: 'The token has expired'
      }
    },
    {
      token: t.context.validToken,
      statusCode: 200,
      body: {
        uid: t.context.validTokenUsername
      }
    },
    {
      token: t.context.nonJsonResponseToken,
      statusCode: 200,
      body: 'asdf'
    },
    {
      token: t.context.unexpectedResponseToken,
      statusCode: 403,
      body: {
        error: 'something_unexpected',
        error_description: 'Something unexpected'
      }
    }
  ];

  nockInterceptors.forEach(({ token, statusCode, body }) => {
    nock(t.context.earthdataLoginEndpoint)
      .persist()
      .post(
        '/oauth/tokens/user',
        {
          token,
          client_id: t.context.clientId,
          on_behalf_of: t.context.onBehalfOf
        }
      )
      .reply(statusCode, body);
  });
});

test('getTokenUsername() returns the username associated with a valid token', async (t) => {
  const response = await EarthdataLogin.getTokenUsername({
    ...t.context.defaultParams,
    token: t.context.validToken
  });

  t.is(response, t.context.validTokenUsername);
});

test('getTokenUsername() throws an exception for an invalid token', async (t) => {
  const error = await t.throwsAsync(
    EarthdataLogin.getTokenUsername({
      ...t.context.defaultParams,
      token: t.context.invalidToken
    }),
    { instanceOf: EarthdataLogin.TokenValidationError }
  );

  t.is(error.code, 'InvalidToken');
});

test('getTokenUsername() throws an exception for an expired token', async (t) => {
  const error = await t.throwsAsync(
    EarthdataLogin.getTokenUsername({
      ...t.context.defaultParams,
      token: t.context.expiredToken
    }),
    { instanceOf: EarthdataLogin.TokenValidationError }
  );

  t.is(error.code, 'TokenExpired');
});

test('getTokenUsername() throws an exception if EarthdataLogin does not return valid JSON', async (t) => {
  const error = await t.throwsAsync(
    EarthdataLogin.getTokenUsername({
      ...t.context.defaultParams,
      token: t.context.nonJsonResponseToken
    }),
    { instanceOf: EarthdataLogin.TokenValidationError }
  );

  t.is(error.code, 'InvalidResponse');
});

test('getTokenUsername() throws an exception if EarthdataLogin returns an unexpected error', async (t) => {
  const error = await t.throwsAsync(
    EarthdataLogin.getTokenUsername({
      ...t.context.defaultParams,
      token: t.context.unexpectedResponseToken
    }),
    { instanceOf: EarthdataLogin.TokenValidationError }
  );

  t.is(error.code, 'UnexpectedResponse');
});
