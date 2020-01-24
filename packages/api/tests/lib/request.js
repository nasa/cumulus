'use strict';

const test = require('ava');
const {
  sign: jwtSign,
  JsonWebTokenError,
  TokenExpiredError
} = require('jsonwebtoken');
const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const {
  testUtils: {
    randomString
  }
} = require('@cumulus/common');
const { noop } = require('@cumulus/common/util');

const {
  TokenUnauthorizedUserError
} = require('../../lib/errors');
const { verifyJwtAuthorization } = require('../../lib/request');
const {
  fakeAccessTokenFactory,
  setAuthorizedOAuthUsers
} = require('../../lib/testUtils');
const { createJwtToken } = require('../../lib/token');

test.before(async () => {
  process.env.TOKEN_SECRET = randomString();
  process.env.AccessTokensTable = randomString();

  process.env.stackName = randomString();
  process.env.system_bucket = randomString();
  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();
  await setAuthorizedOAuthUsers([]);
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket).catch(noop);
});

test('verifyJwtAuthorization() throws JsonWebTokenError for non-JWT token', async (t) => {
  try {
    await verifyJwtAuthorization('invalid-token');
    t.fail('Expected error to be thrown');
  } catch (err) {
    t.true(err instanceof JsonWebTokenError);
    t.is(err.message, 'jwt malformed');
  }
});

test('verifyJwtAuthorization() throws JsonWebTokenError for token signed with invalid secret', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory();
  const jwtToken = jwtSign(accessTokenRecord, 'invalid-secret', {
    algorithm: 'HS256'
  });

  try {
    await verifyJwtAuthorization(jwtToken);
    t.fail('Expected error to be thrown');
  } catch (err) {
    t.true(err instanceof JsonWebTokenError);
    t.is(err.message, 'invalid signature');
  }
});

test('verifyJwtAuthorization() throws JsonWebTokenError for token signed with invalid algorithm', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory();
  const jwtToken = jwtSign(accessTokenRecord, process.env.TOKEN_SECRET, {
    algorithm: 'HS512'
  });

  try {
    await verifyJwtAuthorization(jwtToken);
    t.fail('Expected error to be thrown');
  } catch (err) {
    t.true(err instanceof JsonWebTokenError);
    t.is(err.message, 'invalid algorithm');
  }
});


test('verifyJwtAuthorization() throws TokenExpiredError for expired token', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory({
    expirationTime: Date.now() - 60
  });
  const expiredJwtToken = createJwtToken(accessTokenRecord);

  try {
    await verifyJwtAuthorization(expiredJwtToken);
    t.fail('Expected error to be thrown');
  } catch (err) {
    t.true(err instanceof TokenExpiredError);
  }
});

test('verifyJwtAuthorization() throws TokenUnauthorizedUserError for unauthorized user token', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory();
  const jwtToken = createJwtToken(accessTokenRecord);

  try {
    await verifyJwtAuthorization(jwtToken);
    t.fail('Expected error to be thrown');
  } catch (err) {
    t.true(err instanceof TokenUnauthorizedUserError);
  }
});
