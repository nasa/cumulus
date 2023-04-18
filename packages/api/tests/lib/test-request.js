'use strict';

const test = require('ava');
const {
  sign: jwtSign,
  JsonWebTokenError,
  TokenExpiredError,
} = require('jsonwebtoken');
const moment = require('moment');

const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const noop = require('lodash/noop');

const {
  TokenUnauthorizedUserError,
} = require('../../lib/errors');
const {
  verifyJwtAuthorization,
  getFunctionNameFromRequestContext,
  isMinVersionApi,
} = require('../../lib/request');
const {
  fakeAccessTokenFactory,
  setAuthorizedOAuthUsers,
} = require('../../lib/testUtils');
const { createJwtToken } = require('../../lib/token');

test.before(async () => {
  process.env.TOKEN_SECRET = randomString();
  process.env.AccessTokensTable = randomString();

  process.env.stackName = randomString();
  process.env.system_bucket = randomString();
  await s3().createBucket({ Bucket: process.env.system_bucket });
  await setAuthorizedOAuthUsers([]);
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket).catch(noop);
});

test('isMinVersionApi returns true if req.headers.version is equal to the minVersion', (t) => {
  const reqObject = { headers: { 'cumulus-api-version': '2' } };
  const minVersion = 2;
  isMinVersionApi(reqObject, minVersion);
  t.true(isMinVersionApi(reqObject, minVersion));
});

test('isMinVersionApi returns false if req.headers.version is less than the minVersion', (t) => {
  const reqObject = { headers: { 'cumulus-api-version': '1' } };
  const minVersion = 2;
  isMinVersionApi(reqObject, minVersion);
  t.false(isMinVersionApi(reqObject, minVersion));
});

test('isMinVersionApi returns false if req.headers.version is greater than the minVersion', (t) => {
  const reqObject = { headers: { 'cumulus-api-version': '50' } };
  const minVersion = 2;
  isMinVersionApi(reqObject, minVersion);
  t.true(isMinVersionApi(reqObject, minVersion));
});

test('isMinVersionApi returns false if req.headers.version is NaN', (t) => {
  const reqObject = { headers: { 'cumulus-api-version': 'foobar' } };
  const minVersion = 2;
  isMinVersionApi(reqObject, minVersion);
  t.false(isMinVersionApi(reqObject, minVersion));
});

test('verifyJwtAuthorization() throws JsonWebTokenError for non-JWT token', async (t) => {
  try {
    await verifyJwtAuthorization('invalid-token');
    t.fail('Expected error to be thrown');
  } catch (error) {
    t.true(error instanceof JsonWebTokenError);
    t.is(error.message, 'jwt malformed');
  }
});

test('verifyJwtAuthorization() throws JsonWebTokenError for token signed with invalid secret', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory();
  const jwtToken = jwtSign(accessTokenRecord, 'invalid-secret', {
    algorithm: 'HS256',
  });

  try {
    await verifyJwtAuthorization(jwtToken);
    t.fail('Expected error to be thrown');
  } catch (error) {
    t.true(error instanceof JsonWebTokenError);
    t.is(error.message, 'invalid signature');
  }
});

test('verifyJwtAuthorization() throws JsonWebTokenError for token signed with invalid algorithm', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory();
  const jwtToken = jwtSign(accessTokenRecord, process.env.TOKEN_SECRET, {
    algorithm: 'HS512',
  });

  try {
    await verifyJwtAuthorization(jwtToken);
    t.fail('Expected error to be thrown');
  } catch (error) {
    t.true(error instanceof JsonWebTokenError);
    t.is(error.message, 'invalid algorithm');
  }
});

test('verifyJwtAuthorization() throws TokenExpiredError for expired token', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory({
    expirationTime: moment().unix(),
  });
  const expiredJwtToken = createJwtToken(accessTokenRecord);

  try {
    await verifyJwtAuthorization(expiredJwtToken);
    t.fail('Expected error to be thrown');
  } catch (error) {
    t.true(error instanceof TokenExpiredError);
  }
});

test('verifyJwtAuthorization() throws TokenUnauthorizedUserError for unauthorized user token', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory();
  const jwtToken = createJwtToken(accessTokenRecord);

  try {
    await verifyJwtAuthorization(jwtToken);
    t.fail('Expected error to be thrown');
  } catch (error) {
    t.true(error instanceof TokenUnauthorizedUserError);
  }
});

test('getFunctionNameFromRequestContext returns correct value', (t) => {
  const functionName = randomId('lambda');
  t.is(
    getFunctionNameFromRequestContext({
      apiGateway: {
        context: {
          functionName,
        },
      },
    }),
    functionName
  );
});

test('getFunctionNameFromRequestContext returns undefined if no value exists', (t) => {
  t.is(
    getFunctionNameFromRequestContext({}),
    undefined
  );
});
