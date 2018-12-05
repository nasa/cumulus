'use strict';

const test = require('ava');
const {
  sign: jwtSign,
  JsonWebTokenError,
  TokenExpiredError
} = require('jsonwebtoken');
const {
  testUtils: {
    randomString
  }
} = require('@cumulus/common');

const {
  TokenUnauthorizedUserError,
  TokenNotFoundError
} = require('../../lib/errors');
const { verifyRequestAuthorization } = require('../../lib/request');
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

test('verifyRequestAuthorization() throws JsonWebTokenError for non-JWT token', async (t) => {
  try {
    await verifyRequestAuthorization('invalid-token');
    t.fail('Expected error to be thrown');
  }
  catch (err) {
    t.true(err instanceof JsonWebTokenError);
    t.is(err.message, 'jwt malformed');
  }
});

test('verifyRequestAuthorization() throws JsonWebTokenError for token signed with invalid secret', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory();
  const jwtToken = jwtSign(accessTokenRecord, 'invalid-secret', {
    algorithm: 'HS256'
  });

  try {
    await verifyRequestAuthorization(jwtToken);
    t.fail('Expected error to be thrown');
  }
  catch (err) {
    t.true(err instanceof JsonWebTokenError);
    t.is(err.message, 'invalid signature');
  }
});

test('verifyRequestAuthorization() throws JsonWebTokenError for token signed with invalid algorithm', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory();
  const jwtToken = jwtSign(accessTokenRecord, process.env.TOKEN_SECRET, {
    algorithm: 'HS512'
  });

  try {
    await verifyRequestAuthorization(jwtToken);
    t.fail('Expected error to be thrown');
  }
  catch (err) {
    t.true(err instanceof JsonWebTokenError);
    t.is(err.message, 'invalid algorithm');
  }
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

test('verifyRequestAuthorization() throws TokenNotFoundError for non-existent access token', async (t) => {
  const userRecord = fakeUserFactory();
  const { userName: username } = await userModel.create(userRecord);

  const { accessToken, expirationTime } = fakeAccessTokenFactory();

  const jwtToken = createJwtToken({ accessToken, expirationTime, username });

  try {
    await verifyRequestAuthorization(jwtToken);
    t.fail('Expected error to be thrown');
  }
  catch (err) {
    t.true(err instanceof TokenNotFoundError);
  }
});
