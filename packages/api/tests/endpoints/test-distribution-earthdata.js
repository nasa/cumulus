'use strict';

const test = require('ava');
const request = require('supertest');
const cryptoRandomString = require('crypto-random-string');
const jsyaml = require('js-yaml');
const sinon = require('sinon');
const { Cookie } = require('tough-cookie');
const { URL } = require('url');

const { createBucket, s3PutObject, recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const { getLocalstackEndpoint } = require('@cumulus/aws-client/test-utils');
const { randomId } = require('@cumulus/common/test-utils');
const { OAuthClient, EarthdataLoginClient } = require('@cumulus/oauth-client');

const { AccessToken } = require('../lib/access-token');
const { fakeAccessTokenFactory } = require('../../lib/testUtils');

process.env.OAUTH_CLIENT_ID = randomId('edlId');
process.env.OAUTH_CLIENT_PASSWORD = randomId('edlPw');
process.env.DISTRIBUTION_REDIRECT_ENDPOINT = 'http://example.com';
process.env.DISTRIBUTION_ENDPOINT = `https://${randomId('host')}/${randomId('path')}`;
process.env.OAUTH_HOST_URL = `https://${randomId('host')}/${randomId('path')}`;
process.env.OAUTH_PROVIDER = 'earthdata';
process.env.AccessTokensTable = randomId('tokenTable');
process.env.stackName = cryptoRandomString({ length: 10 });
process.env.system_bucket = cryptoRandomString({ length: 10 });
process.env.BUCKET_MAP_FILE = `${process.env.stackName}/cumulus_distribution/bucket_map.yaml`;

let headObjectStub;

// import the express app after setting the env variables
const { distributionApp } = require('../../app/distribution');

const publicBucket = randomId('publicbucket');
const publicBucketPath = randomId('publicpath');
const protectedBucket = randomId('protectedbucket');
const privateBucket = randomId('privatebucket');

const bucketMap = {
  MAP: {
    path1: {
      bucket: 'bucket-path-1',
      headers: {
        'Content-Type': 'text/plain',
      },
    },
    [protectedBucket]: protectedBucket,
    [publicBucketPath]: publicBucket,
    [privateBucket]: privateBucket,
  },
  PUBLIC_BUCKETS: {
    [publicBucket]: 'public bucket',
  },
  PRIVATE_BUCKETS: {
    [privateBucket]: ['internal_users', 'external_team'],
    [`${privateBucket}/sc`]: ['internal_users', 'sc_users'],
  },
};

const invalidToken = randomId('invalidToken');

let context;

function headerIs(headers, name, value) {
  return headers[name.toLowerCase()] === value;
}

function validateDefaultHeaders(t, response) {
  t.true(headerIs(response.headers, 'Access-Control-Allow-Origin', '*'));
  t.true(headerIs(response.headers, 'Strict-Transport-Security', 'max-age=31536000; includeSubDomains'));
}

function validateRedirectToGetAuthorizationCode(t, response) {
  const { authorizationUrl } = context;

  t.is(response.status, 307);
  validateDefaultHeaders(t, response);
  t.true(headerIs(response.headers, 'Location', authorizationUrl));
}

function stubHeadObject() {
  headObjectStub = sinon.stub(s3(), 'headObject').resolves();
}

function restoreHeadObjectStub() {
  headObjectStub.restore();
}

test.before(async () => {
  await createBucket(process.env.system_bucket);
  await s3PutObject({
    Bucket: process.env.system_bucket,
    Key: process.env.BUCKET_MAP_FILE,
    Body: jsyaml.dump(bucketMap),
  });

  const accessTokenModel = new AccessToken({ tableName: process.env.AccessTokensTable });
  await accessTokenModel.createTable();

  const authorizationUrl = `https://${randomId('host')}.com/${randomId('path')}`;
  const fileKey = randomId('key');
  const fileLocation = `${protectedBucket}/${fileKey}`;
  const s3Endpoint = getLocalstackEndpoint('S3');

  const getAccessTokenResponse = fakeAccessTokenFactory();
  const getUserInfoResponse = { foo: 'bar', uid: getAccessTokenResponse.username };

  sinon.stub(
    OAuthClient.prototype,
    'getAccessToken'
  ).callsFake(() => getAccessTokenResponse);

  sinon.stub(
    EarthdataLoginClient.prototype,
    'getTokenUsername'
  ).callsFake(() => getAccessTokenResponse.username);

  sinon.stub(
    OAuthClient.prototype,
    'getAuthorizationUrl'
  ).callsFake(() => authorizationUrl);

  sinon.stub(
    EarthdataLoginClient.prototype,
    'getUserInfo'
  ).callsFake(({ token }) => {
    if (token === invalidToken) throw new Error('Invalid token');
    return getUserInfoResponse;
  });

  const accessTokenRecord = fakeAccessTokenFactory({
    tokenInfo: { anykey: randomId('anyvalue'), user_groups: [randomId('usergroups'), 'external_team'] },
  });
  await accessTokenModel.create(accessTokenRecord);

  context = {
    accessTokenModel,
    accessTokenRecord,
    accessTokenCookie: accessTokenRecord.accessToken,
    getAccessTokenResponse,
    fileKey,
    fileLocation,
    authorizationUrl,
    authorizationCode: randomId('code'),
    distributionUrl: process.env.DISTRIBUTION_ENDPOINT,
    s3Endpoint,
  };
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  const { accessTokenModel } = context;

  await accessTokenModel.deleteTable();
  sinon.reset();
});

test.serial('A request for a file without an access token returns a redirect to an OAuth2 provider', async (t) => {
  const { fileLocation } = context;
  const response = await request(distributionApp)
    .get(`/${fileLocation}`)
    .set('Accept', 'application/json')
    .expect(307);

  validateRedirectToGetAuthorizationCode(t, response);
});

test.serial('An authenticated request for a file returns a redirect to S3', async (t) => {
  stubHeadObject();
  const {
    accessTokenCookie,
    accessTokenRecord,
    fileLocation,
    s3Endpoint,
  } = context;

  const response = await request(distributionApp)
    .get(`/${fileLocation}`)
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenCookie}`])
    .expect(307);

  t.teardown(() => restoreHeadObjectStub());

  validateDefaultHeaders(t, response);

  const redirectLocation = new URL(response.headers.location);
  const signedFileUrl = new URL(`${s3Endpoint}/${fileLocation}`);
  t.is(redirectLocation.origin, signedFileUrl.origin);
  t.is(redirectLocation.pathname, signedFileUrl.pathname);
  t.is(redirectLocation.searchParams.get('A-userid'), accessTokenRecord.username);
});

test.serial('A request for a file with a valid bearer token returns a redirect to S3', async (t) => {
  stubHeadObject();
  const {
    fileLocation,
    getAccessTokenResponse,
    s3Endpoint,
  } = context;

  const response = await request(distributionApp)
    .get(`/${fileLocation}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${randomId('token')}`)
    .expect(307);

  t.teardown(() => restoreHeadObjectStub());
  t.is(response.status, 307);
  validateDefaultHeaders(t, response);

  const redirectLocation = new URL(response.headers.location);
  const signedFileUrl = new URL(`${s3Endpoint}/${fileLocation}`);
  t.is(redirectLocation.origin, signedFileUrl.origin);
  t.is(redirectLocation.pathname, signedFileUrl.pathname);
  t.is(redirectLocation.searchParams.get('A-userid'), getAccessTokenResponse.username);
});

test.serial('A request for a file with an invalid bearer token returns a redirect to an OAuth2 provider', async (t) => {
  const { fileLocation } = context;

  const response = await request(distributionApp)
    .get(`/${fileLocation}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${invalidToken}`)
    .expect(307);

  validateRedirectToGetAuthorizationCode(t, response);
});

test.serial('An authenticated request for a file from private bucket returns a redirect to S3 when user group is in list', async (t) => {
  stubHeadObject();
  const {
    accessTokenCookie,
    accessTokenRecord,
    fileKey,
    s3Endpoint,
  } = context;

  const fileLocation = `${privateBucket}/${fileKey}`;
  const response = await request(distributionApp)
    .get(`/${fileLocation}`)
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenCookie}`])
    .expect(307);

  t.teardown(() => restoreHeadObjectStub());
  validateDefaultHeaders(t, response);

  const redirectLocation = new URL(response.headers.location);
  const signedFileUrl = new URL(`${s3Endpoint}/${fileLocation}`);
  t.is(redirectLocation.origin, signedFileUrl.origin);
  t.is(redirectLocation.pathname, signedFileUrl.pathname);
  t.is(redirectLocation.searchParams.get('A-userid'), accessTokenRecord.username);
});

test.serial('An authenticated request for a file from private bucket returns error when user group is not in list', async (t) => {
  stubHeadObject();
  const {
    accessTokenCookie,
    fileKey,
  } = context;

  const response = await request(distributionApp)
    .get(`/${privateBucket}/sc/${fileKey}`)
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenCookie}`])
    .expect(403);

  t.teardown(() => restoreHeadObjectStub());

  t.true(JSON.stringify(response.error).includes('Could not access data'));
  t.true(JSON.stringify(response.error).includes('This data is not currently available'));
});

test('A /login request with a good authorization code returns a correct response', async (t) => {
  const {
    authorizationCode,
    getAccessTokenResponse,
    distributionUrl,
    fileLocation,
  } = context;

  const response = await request(distributionApp)
    .get('/login')
    .query({ code: authorizationCode, state: fileLocation })
    .set('Accept', 'application/json')
    .expect(301);

  t.is(response.status, 301);
  validateDefaultHeaders(t, response);
  t.is(response.headers.location, `${distributionUrl}/${fileLocation}`);

  const cookies = response.headers['set-cookie'].map(Cookie.parse);
  const setAccessTokenCookie = cookies.find((c) => c.key === 'accessToken');

  t.truthy(setAccessTokenCookie);
  t.is(setAccessTokenCookie.value, getAccessTokenResponse.accessToken);
  t.is(setAccessTokenCookie.httpOnly, true);
  t.is(setAccessTokenCookie.secure, true);

  t.is(
    setAccessTokenCookie.expires.valueOf(),
    // expirationTime only has per-second precision
    getAccessTokenResponse.expirationTime * 1000
  );
});

test('A /login request with a good authorization code stores the access token', async (t) => {
  const {
    accessTokenModel,
    authorizationCode,
    fileLocation,
  } = context;

  const response = await request(distributionApp)
    .get('/login')
    .query({ code: authorizationCode, state: fileLocation })
    .set('Accept', 'application/json')
    .expect(301);

  const cookies = response.headers['set-cookie'].map(Cookie.parse);
  const setAccessTokenCookie = cookies.find((c) => c.key === 'accessToken');

  t.true(await accessTokenModel.exists({ accessToken: setAccessTokenCookie.value }));
});
