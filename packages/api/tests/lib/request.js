'use strict';

const test = require('ava');
const { JsonWebTokenError, TokenExpiredError } = require('jsonwebtoken');
const {
  testUtils: {
    randomString
  }
} = require('@cumulus/common');

const assertions = require('../../lib/assertions');
const {
  TokenUnauthorizedUserError,
  TokenNotFoundError
} = require('../../lib/errors');
const {
  verifyRequestAuthorization,
  handleRequestAuthorizationError
} = require('../../lib/request');
const {
  fakeAccessTokenFactory,
  fakeUserFactory
} = require('../../lib/testUtils');
const { createJwtToken } = require('../../lib/token');
const { User } = require('../../models');

let userModel;

test.before(async () => {
  process.env.TOKEN_SECRET = randomString();
  process.env.AccessTokensTable = randomString();
  process.env.UsersTable = randomString();

  userModel = new User();
  await userModel.createTable();
});

test.after.always(async () => {
  await userModel.deleteTable();
});

test('verifyRequestAuthorization() throws JsonWebTokenError for invalid token', async (t) => {
  try {
    await verifyRequestAuthorization('invalid-token');
    t.fail('Expected error to be thrown');
  }
  catch (err) {
    t.true(err instanceof JsonWebTokenError);
  }
});

test('handleRequestAuthorizationError() returns invalid token response for JsonWebTokenError', async (t) => {
  const response = handleRequestAuthorizationError(new JsonWebTokenError());
  assertions.isInvalidAccessTokenResponse(t, response);
});

test('verifyRequestAuthorization() throws TokenExpiredError for expired token', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory({
    expirationTime: Date.now() - 60
  });
  const expiredJwtToken = createJwtToken(accessTokenRecord);

  try {
    await verifyRequestAuthorization(expiredJwtToken);
    t.fail('Expected error to be thrown');
  }
  catch (err) {
    t.true(err instanceof TokenExpiredError);
  }
});

test('handleRequestAuthorizationError() returns expired token response for TokenExpiredError', async (t) => {
  const response = handleRequestAuthorizationError(new TokenExpiredError());
  assertions.isExpiredAccessTokenResponse(t, response);
});

test('verifyRequestAuthorization() throws TokenUnauthorizedUserError for unauthorized user token', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory();
  const jwtToken = createJwtToken(accessTokenRecord);

  try {
    await verifyRequestAuthorization(jwtToken);
    t.fail('Expected error to be thrown');
  }
  catch (err) {
    t.true(err instanceof TokenUnauthorizedUserError);
  }
});

test('handleRequestAuthorizationError() returns unauthorized user response for TokenUnauthorizedUserError', async (t) => {
  const response = handleRequestAuthorizationError(new TokenUnauthorizedUserError());
  assertions.isUnauthorizedUserResponse(t, response);
});

test('verifyRequestAuthorization() throws TokenNotFoundError for non-existent access token', async (t) => {
  const userRecord = fakeUserFactory();
  await userModel.create(userRecord);

  const { accessToken, expirationTime } = fakeAccessTokenFactory();

  const jwtToken = createJwtToken({ accessToken, expirationTime, username: userRecord.userName });

  try {
    await verifyRequestAuthorization(jwtToken);
    t.fail('Expected error to be thrown');
  }
  catch (err) {
    t.true(err instanceof TokenNotFoundError);
  }
});

test('handleRequestAuthorizationError() returns invalid token response for TokenNotFoundError', async (t) => {
  const response = handleRequestAuthorizationError(new TokenNotFoundError());
  assertions.isInvalidAccessTokenResponse(t, response);
});