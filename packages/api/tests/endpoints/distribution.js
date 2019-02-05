'use strict';

const test = require('ava');
const request = require('supertest');
const sinon = require('sinon');
const { Cookie } = require('tough-cookie');
const { URL } = require('url');
const { s3 } = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');

const { AccessToken } = require('../../models');
const EarthdataLoginClient = require('../../lib/EarthdataLogin');
const { fakeAccessTokenFactory } = require('../../lib/testUtils');

process.env.EARTHDATA_CLIENT_ID = randomString();
process.env.EARTHDATA_CLIENT_PASSWORD = randomString();
process.env.DISTRIBUTION_REDIRECT_URI = 'http://example.com';
process.env.DISTRIBUTION_ENDPOINT = `https://${randomString()}/${randomString()}`;
process.env.AccessTokensTable = randomString();
let context;

// import the express app after setting the env variables
const { distributionApp } = require('../../app/distribution');

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

test.before(async () => {
  const accessTokenModel = new AccessToken({ tableName: process.env.AccessTokensTable });
  await accessTokenModel.createTable();

  const authorizationUrl = `https://${randomString()}.com/${randomString()}`;
  const fileBucket = randomString();
  const fileKey = randomString();
  const fileLocation = `${fileBucket}/${fileKey}`;
  const signedFileUrl = new URL(`https://${randomString()}.com/${randomString()}`);


  const getAccessTokenResponse = {
    accessToken: randomString(),
    refreshToken: randomString(),
    username: randomString(),
    expirationTime: Date.now() + (60 * 60 * 1000)
  };

  sinon.stub(
    EarthdataLoginClient.prototype,
    'getAccessToken'
  ).callsFake(() => getAccessTokenResponse);

  sinon.stub(
    EarthdataLoginClient.prototype,
    'getAuthorizationUrl'
  ).callsFake(() => authorizationUrl);

  const accessTokenRecord = fakeAccessTokenFactory();
  await accessTokenModel.create(accessTokenRecord);

  sinon.stub(s3(), 'getSignedUrl').callsFake((operation, params) => {
    if (operation !== 'getObject') {
      throw new Error(`Unexpected operation: ${operation}`);
    }

    if (params.Bucket !== fileBucket) {
      throw new Error(`Unexpected params.Bucket: ${params.Bucket}`);
    }

    if (params.Key !== fileKey) {
      throw new Error(`Unexpected params.Key: ${params.Key}`);
    }

    return signedFileUrl.toString();
  });

  context = {
    accessTokenModel,
    accessTokenRecord,
    accessTokenCookie: accessTokenRecord.accessToken,
    getAccessTokenResponse,
    fileBucket,
    fileKey,
    fileLocation,
    authorizationUrl,
    signedFileUrl,
    authorizationCode: randomString(),
    distributionUrl: process.env.DISTRIBUTION_ENDPOINT
  };
});

test.after.always(async () => {
  const { accessTokenModel } = context;

  await accessTokenModel.deleteTable();
  sinon.reset();
});

test('A request for a file without an access token returns a redirect to an OAuth2 provider', async (t) => {
  const { fileLocation } = context;
  const response = await request(distributionApp)
    .get(`/${fileLocation}`)
    .set('Accept', 'application/json')
    .expect(307);

  validateRedirectToGetAuthorizationCode(t, response);
});

test('A request for a file using a non-existent access token returns a redirect to an OAuth2 provider', async (t) => {
  const { fileLocation } = context;
  const response = await request(distributionApp)
    .get(`/${fileLocation}`)
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${randomString()}`])
    .expect(307);

  validateRedirectToGetAuthorizationCode(t, response);
});

test('A request for a file using an expired access token returns a redirect to an OAuth2 provider', async (t) => {
  const { accessTokenModel, fileLocation } = context;

  const accessTokenRecord = fakeAccessTokenFactory({
    expirationTime: Date.now() - (5 * 1000)
  });
  await accessTokenModel.create(accessTokenRecord);

  const response = await request(distributionApp)
    .get(`/${fileLocation}`)
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenRecord.accessToken}`])
    .expect(307);

  validateRedirectToGetAuthorizationCode(t, response);
});

test('An authenticated request for a file that cannot be parsed returns a 404', async (t) => {
  const { accessTokenCookie } = context;
  const response = await request(distributionApp)
    .get('/invalid')
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenCookie}`])
    .expect(404);

  t.is(response.statusCode, 404);
});

test('An authenticated request for a file returns a redirect to S3', async (t) => {
  const {
    accessTokenCookie,
    accessTokenRecord,
    fileLocation,
    signedFileUrl
  } = context;


  const response = await request(distributionApp)
    .get(`/${fileLocation}`)
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenCookie}`])
    .expect(307);

  t.is(response.status, 307);
  validateDefaultHeaders(t, response);

  const redirectLocation = new URL(response.headers.location);
  t.is(redirectLocation.origin, signedFileUrl.origin);
  t.is(redirectLocation.pathname, signedFileUrl.pathname);
  t.is(redirectLocation.searchParams.get('x-EarthdataLoginUsername'), accessTokenRecord.username);
});

test('A /redirect request with a good authorization code returns a correct response', async (t) => {
  const {
    authorizationCode,
    getAccessTokenResponse,
    distributionUrl,
    fileLocation
  } = context;

  const response = await request(distributionApp)
    .get('/redirect')
    .query({ code: authorizationCode, state: fileLocation })
    .set('Accept', 'application/json')
    .expect(307);

  t.is(response.status, 307);
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
    // Cookie expirations only have per-second precision
    getAccessTokenResponse.expirationTime - (getAccessTokenResponse.expirationTime % 1000)
  );
});

test('A /redirect request with a good authorization code stores the access token', async (t) => {
  const {
    accessTokenModel,
    authorizationCode,
    fileLocation
  } = context;


  const response = await request(distributionApp)
    .get('/redirect')
    .query({ code: authorizationCode, state: fileLocation })
    .set('Accept', 'application/json')
    .expect(307);

  const cookies = response.headers['set-cookie'].map(Cookie.parse);
  const setAccessTokenCookie = cookies.find((c) => c.key === 'accessToken');

  t.true(await accessTokenModel.exists({ accessToken: setAccessTokenCookie.value }));
});
