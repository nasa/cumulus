'use strict';

/* eslint-disable lodash/prefer-noop */
const { Cookie } = require('tough-cookie');
const cryptoRandomString = require('crypto-random-string');
const test = require('ava');
const sinon = require('sinon');
const request = require('supertest');
const moment = require('moment');

const awsServices = require('@cumulus/aws-client/services');

const { EarthdataLoginClient } = require('@cumulus/oauth-client');

const models = require('@cumulus/api/models');
const { fakeAccessTokenFactory } = require('@cumulus/api/lib/testUtils');

const randomString = () => cryptoRandomString({ length: 6 });
const randomId = (prefix, separator = '-') =>
  [prefix, randomString()].filter((x) => x).join(separator);

process.env.OAUTH_PROVIDER = 'earthdata';
process.env.OAUTH_CLIENT_ID = randomId('edlID');
process.env.OAUTH_CLIENT_PASSWORD = randomId('edlPW');
process.env.DISTRIBUTION_REDIRECT_ENDPOINT = 'http://example.com';
process.env.OAUTH_HOST_URL = 'https://sandbox.urs.earthdata.nasa.gov';
process.env.DISTRIBUTION_ENDPOINT = `https://${randomId('host')}/${randomId('path')}`;
process.env.AccessTokensTable = randomId('tokenTable');
process.env.TOKEN_SECRET = randomId('tokenSecret');

let accessTokenModel;
const {
  distributionApp,
  handleTokenAuthRequest,
} = require('..');

const buildEarthdataLoginClient = () =>
  new EarthdataLoginClient({
    clientId: process.env.OAUTH_CLIENT_ID,
    clientPassword: process.env.OAUTH_CLIENT_PASSWORD,
    loginUrl: 'https://sandbox.urs.earthdata.nasa.gov',
    redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT,
  });

const invalidToken = randomId('invalidToken');

test.before(async (t) => {
  accessTokenModel = new models.AccessToken('token');
  await accessTokenModel.createTable();

  const stubbedAccessToken = fakeAccessTokenFactory();
  await accessTokenModel.create(stubbedAccessToken);
  const getUserInfoResponse = { foo: 'bar', uid: stubbedAccessToken.username };

  sinon.stub(
    EarthdataLoginClient.prototype,
    'getAccessToken'
  ).callsFake(() => stubbedAccessToken);

  sinon.stub(
    EarthdataLoginClient.prototype,
    'getTokenUsername'
  ).callsFake(({ token }) => {
    if (token === invalidToken) throw new Error('Invalid token');
    return stubbedAccessToken.username;
  });

  sinon.stub(
    EarthdataLoginClient.prototype,
    'getUserInfo'
  ).callsFake(({ token }) => {
    if (token === invalidToken) throw new Error('Invalid token');
    return getUserInfoResponse;
  });

  t.context = { stubbedAccessToken };
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  sinon.reset();
});

test.serial('An authorized s3credential request invokes NGAPs request for credentials with username from accessToken cookie', async (t) => {
  const username = randomId('username');
  const fakeCredential = { Payload: new TextEncoder().encode(JSON.stringify({ fake: 'credential' })) };

  const spy = sinon.spy(() => Promise.resolve(fakeCredential));
  const stub = sinon.stub(awsServices, 'lambda').callsFake(() => ({
    invoke: (params) => spy(params),
  }));

  const accessTokenRecord = fakeAccessTokenFactory({ username });
  await accessTokenModel.create(accessTokenRecord);

  process.env.STS_CREDENTIALS_LAMBDA = 'Fake-NGAP-Credential-Dispensing-Lambda';
  const FunctionName = process.env.STS_CREDENTIALS_LAMBDA;
  const Payload = new TextEncoder().encode(JSON.stringify({
    accesstype: 'sameregion',
    returntype: 'lowerCamel',
    duration: '3600',
    rolesession: username,
    userid: username,
  }));

  await request(distributionApp)
    .get('/s3credentials')
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenRecord.accessToken}`])
    .expect(200);

  t.true(spy.called);
  t.deepEqual(spy.args[0][0], {
    FunctionName,
    Payload,
  });
  stub.restore();
});

test('An s3credential request without access Token redirects to Oauth2 provider.', async (t) => {
  const response = await request(distributionApp)
    .get('/s3credentials')
    .set('Accept', 'application/json')
    .expect(307);
  const authorizationUrl = buildEarthdataLoginClient().getAuthorizationUrl(response.req.path);

  t.is(response.status, 307);
  t.is(response.headers.location, authorizationUrl);
});

test('An s3credential request with expired accessToken redirects to Oauth2 provider', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory({
    expirationTime: moment().unix(),
  });
  await accessTokenModel.create(accessTokenRecord);

  const response = await request(distributionApp)
    .get('/s3credentials')
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenRecord.accessToken}`])
    .expect(307);
  const authorizationUrl = buildEarthdataLoginClient().getAuthorizationUrl(response.req.path);

  t.is(response.status, 307);
  t.is(response.headers.location, authorizationUrl);
});

test('A redirect request returns a response with an unexpired cookie ', async (t) => {
  const { stubbedAccessToken } = t.context;
  const response = await request(distributionApp)
    .get('/redirect')
    .query({ code: randomId('code'), state: randomId('authorizationUrl') })
    .set('Accept', 'application/json')
    .expect(307);

  const cookie = response.headers['set-cookie'].map(Cookie.parse);
  const accessToken = cookie.find((c) => c.key === 'accessToken');
  t.truthy(accessToken);
  t.is(accessToken.value, stubbedAccessToken.accessToken);
  t.is(
    accessToken.expires.valueOf(),
    stubbedAccessToken.expirationTime * 1000
  );
  t.true(accessToken.expires.valueOf() > Date.now());
});

test('handleTokenAuthRequest() saves the client name in the request, if provided', async (t) => {
  const req = {
    get(headerName) {
      return this.headers[headerName];
    },
    headers: {
      'EDL-Client-Id': 'my-client-id',
      'EDL-Token': 'my-token',
      'EDL-Client-Name': 'my-client-name',
    },
    oauthClient: {
      getTokenUsername() {
        return Promise.resolve('my-username');
      },
    },
  };

  await handleTokenAuthRequest(req, undefined, () => undefined);

  t.is(req.authorizedMetadata.clientName, 'my-client-name');
});

test('handleTokenAuthRequest() with an invalid client name results in a "Bad Request" response', async (t) => {
  const req = {
    get(headerName) {
      return this.headers[headerName];
    },
    headers: {
      'EDL-Client-Id': 'my-client-id',
      'EDL-Token': 'my-token',
      'EDL-Client-Name': 'not valid',
    },
    oauthClient: {
      getTokenUsername() {
        return Promise.resolve('my-username');
      },
    },
  };

  const res = {
    boom: {
      badRequest: () => 'response-from-boom-badRequest',
    },
  };

  const next = () => t.fail('next() should not have been called');

  t.is(
    await handleTokenAuthRequest(req, res, next),
    'response-from-boom-badRequest'
  );
});

test.serial('An s3credential request with DISABLE_S3_CREDENTIALS set to true results in a 503 error', async (t) => {
  process.env.DISABLE_S3_CREDENTIALS = true;
  const username = randomId('username');
  const accessTokenRecord = fakeAccessTokenFactory({ username });
  await accessTokenModel.create(accessTokenRecord);

  const response = await request(distributionApp)
    .get('/s3credentials')
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenRecord.accessToken}`])
    .expect(503);

  t.is(response.status, 503);
  t.is(response.body.message, 'S3 Credentials Endpoint has been disabled');
  t.teardown(() => {
    delete process.env.DISABLE_S3_CREDENTIALS;
  });
});
/* eslint-enable lodash/prefer-noop */

test.serial('An s3credential request with a valid bearer token invokes NGAPs request for credentials with username from token', async (t) => {
  const username = t.context.stubbedAccessToken.username;
  const fakeCredential = { Payload: new TextEncoder().encode(JSON.stringify({ fake: 'credential' })) };

  const spy = sinon.spy(() => Promise.resolve(fakeCredential));
  const stub = sinon.stub(awsServices, 'lambda').callsFake(() => ({
    invoke: (params) => spy(params),
  }));

  process.env.STS_CREDENTIALS_LAMBDA = 'Fake-NGAP-Credential-Dispensing-Lambda';
  const FunctionName = process.env.STS_CREDENTIALS_LAMBDA;
  const Payload = new TextEncoder().encode(JSON.stringify({
    accesstype: 'sameregion',
    returntype: 'lowerCamel',
    duration: '3600',
    rolesession: username,
    userid: username,
  }));

  await request(distributionApp)
    .get('/s3credentials')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${randomId('token')}`)
    .expect(200);

  t.true(spy.called);
  t.deepEqual(spy.args[0][0], {
    FunctionName,
    Payload,
  });
  stub.restore();
});

test('An s3credential request with an invalid bearer token redirects to OAuth2 provider', async (t) => {
  const response = await request(distributionApp)
    .get('/s3credentials')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${invalidToken}`)
    .expect(307);

  const authorizationUrl = buildEarthdataLoginClient().getAuthorizationUrl(response.req.path);

  t.is(response.status, 307);
  t.is(response.headers.location, authorizationUrl);
});
