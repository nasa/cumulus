'use strict';

const test = require('ava');
const request = require('supertest');
const sinon = require('sinon');
const { Cookie } = require('tough-cookie');
const { URL } = require('url');

const { s3 } = require('@cumulus/aws-client/services');
const { randomId } = require('@cumulus/common/test-utils');
const { OAuthClient, EarthdataLoginClient } = require('@cumulus/oauth-client');

const { AccessToken } = require('../../models');
const { fakeAccessTokenFactory } = require('../../lib/testUtils');

process.env.OAUTH_CLIENT_ID = randomId('edlId');
process.env.OAUTH_CLIENT_PASSWORD = randomId('edlPw');
process.env.DISTRIBUTION_REDIRECT_ENDPOINT = 'http://example.com';
process.env.DISTRIBUTION_ENDPOINT = `https://${randomId('host')}/${randomId('path')}`;
process.env.OAUTH_HOST_URL = `https://${randomId('host')}/${randomId('path')}`;
process.env.OAUTH_PROVIDER = 'earthdata';
process.env.AccessTokensTable = randomId('tokenTable');
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

  const authorizationUrl = `https://${randomId('host')}.com/${randomId('path')}`;
  const fileBucket = randomId('bucket');
  const fileKey = randomId('key');
  const fileLocation = `${fileBucket}/${fileKey}`;
  const signedFileUrl = new URL(`https://${randomId('host2')}.com/${randomId('path2')}`);

  const getAccessTokenResponse = fakeAccessTokenFactory();
  const getUserInfoResponse = { foo: 'bar' };

  sinon.stub(
    OAuthClient.prototype,
    'getAccessToken'
  ).callsFake(() => getAccessTokenResponse);

  sinon.stub(
    OAuthClient.prototype,
    'getAuthorizationUrl'
  ).callsFake(() => authorizationUrl);

  sinon.stub(
    EarthdataLoginClient.prototype,
    'getUserInfo'
  ).callsFake(() => getUserInfoResponse);

  const accessTokenRecord = fakeAccessTokenFactory({ tokenInfo: { anykey: randomId('anyvalue') } });
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
    authorizationCode: randomId('code'),
    distributionUrl: process.env.DISTRIBUTION_ENDPOINT,
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
