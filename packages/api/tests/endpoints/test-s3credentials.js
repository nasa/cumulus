'use strict';

const test = require('ava');
const sinon = require('sinon');
const request = require('supertest');

const {
  testUtils: {
    randomId
  },
  aws: {
    lambda
  }
} = require('@cumulus/common');

const EarthdataLoginClient = require('../../lib/EarthdataLogin');

const models = require('../../models');
const { fakeAccessTokenFactory } = require('../../lib/testUtils');

process.env.EARTHDATA_CLIENT_ID = randomId('edlID');
process.env.EARTHDATA_CLIENT_PASSWORD = randomId('edlPW');
process.env.DISTRIBUTION_REDIRECT_ENDPOINT = 'http://example.com';
process.env.DISTRIBUTION_ENDPOINT = `https://${randomId('host')}/${randomId('path')}`;
process.env.AccessTokensTable = randomId('tokenTable');


process.env.TOKEN_SECRET = randomId('tokenSecret');
let accessTokenModel;
let authorizationUrl;

// import the express app after setting the env variables
const { distributionApp } = require('../../app/distribution');


test.before(async () => {
  accessTokenModel = new models.AccessToken('token');
  await accessTokenModel.createTable();


  const getAccessTokenResponse = {
    accessToken: randomId('accessToken'),
    refreshToken: randomId('refreshToken'),
    username: randomId('username'),
    expirationTime: Date.now() + (60 * 60 * 1000)
  };
  authorizationUrl = randomId('authURL');

  sinon.stub(
    EarthdataLoginClient.prototype,
    'getAccessToken'
  ).callsFake(() => getAccessTokenResponse);

  sinon.stub(
    EarthdataLoginClient.prototype,
    'getAuthorizationUrl'
  ).callsFake(() => authorizationUrl);
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  sinon.reset();
});

test('An authorized s3credential requeste invokes NGAPs request for credentials with username from accessToken cookie', async (t) => {
  const username = randomId('username');
  const lambdaInstance = lambda();
  const fakeCredential = { Payload: JSON.stringify({ fake: 'credential' }) };
  const invokeFake = sinon.fake.returns({ promise: () => Promise.resolve(fakeCredential) });
  const previousInvoke = lambdaInstance.invoke;
  lambdaInstance.invoke = invokeFake;

  const accessTokenRecord = fakeAccessTokenFactory({ username });
  await accessTokenModel.create(accessTokenRecord);

  const FunctionName = 'gsfc-ngap-sh-s3-sts-get-keys';
  const Payload = JSON.stringify({
    accesstype: 'sameregion',
    returntype: 'lowerCamel',
    duration: '3600',
    rolesession: username,
    userid: username
  });

  await request(distributionApp)
    .get('/s3credentials')
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenRecord.accessToken}`])
    .expect(200);

  t.true(invokeFake.calledOnceWithExactly({
    FunctionName,
    Payload
  }));

  lambdaInstance.invoke = previousInvoke;
});


test('An s3credential request without access Token redirects to Oauth2 provider.', async (t) => {
  const response = await request(distributionApp)
    .get('/s3credentials')
    .set('Accept', 'application/json')
    .expect(307);

  t.is(response.status, 307);
  t.is(response.headers.location, authorizationUrl);
});

test('An s3credential request with expired accessToken redirects to Oauth2 provider', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory({
    expirationTime: Date.now() - (5 * 1000)
  });
  await accessTokenModel.create(accessTokenRecord);

  const response = await request(distributionApp)
    .get('/s3credentials')
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenRecord.accessToken}`])
    .expect(307);

  t.is(response.status, 307);
  t.is(response.headers.location, authorizationUrl);
});
