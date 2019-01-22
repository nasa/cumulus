'use strict';

const test = require('ava');
const request = require('supertest');
const sinon = require('sinon');
const { URL } = require('url');
const {
  testUtils: {
    randomString
  }
} = require('@cumulus/common');

const { OAuth2AuthenticationFailure } = require('../../lib/OAuth2');
const assertions = require('../../lib/assertions');
const EarthdataLoginClient = require('../../lib/EarthdataLogin');
const {
  createJwtToken
} = require('../../lib/token');
const {
  fakeAccessTokenFactory,
  fakeUserFactory
} = require('../../lib/testUtils');
const { AccessToken, User } = require('../../models');

let accessTokenModel;
let userModel;

process.env.EARTHDATA_CLIENT_ID = randomString();
process.env.EARTHDATA_CLIENT_PASSWORD = randomString();
process.env.API_ENDPOINT = 'http://example.com';
process.env.TOKEN_SECRET = randomString();
process.env.AccessTokensTable = randomString();
process.env.UsersTable = randomString();

// import the express app after setting the env variables
const { app } = require('../../app');

test.before(async () => {
  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  userModel = new User();
  await userModel.createTable();
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await userModel.deleteTable();
});

test.serial('A request for anything other that GET /token results in a 404', async (t) => {
  const response = await request(app)
    .get('/invalid')
    .set('Accept', 'application/json')
    .expect(404);

  t.is(response.status, 404);
});

test.serial('GET /token without a code properly requests the authorization URL from the oAuth2 provider', async (t) => {
  const stub = sinon.stub(
    EarthdataLoginClient.prototype,
    'getAuthorizationUrl'
  ).callsFake((state) => t.is(state, 'my-state'));

  await request(app)
    .get('/token')
    .query({ state: 'my-state' })
    .set('Accept', 'application/json')
    .expect(307);

  stub.restore();
});

test.serial('GET /token without a code returns a redirect authorization URL from the oAuth2 provider', async (t) => {
  const stub = sinon.stub(
    EarthdataLoginClient.prototype,
    'getAuthorizationUrl'
  ).callsFake(() => 'http://www.example.com');

  const response = await request(app)
    .get('/token')
    .query({ state: 'my-state' })
    .set('Accept', 'application/json')
    .expect(307);

  t.is(response.status, 307);
  t.is(response.headers.location, 'http://www.example.com');

  stub.restore();
});

test.serial('GET /token with an invalid code results in an authorization failure response', async (t) => {
  const stub = sinon.stub(
    EarthdataLoginClient.prototype,
    'getAccessToken'
  ).callsFake(async (authorizationCode) => {
    t.is(authorizationCode, 'invalid-authorization-code');
    throw new OAuth2AuthenticationFailure('Failed to get authorization token');
  });

  const response = await request(app)
    .get('/token')
    .query({ code: 'invalid-authorization-code' })
    .set('Accept', 'application/json')
    .expect(401);

  t.is(response.status, 401);
  t.is(response.body.message, 'Failed to get authorization token');
  stub.restore();
});

test.serial('GET /token with a code but no state returns the access token', async (t) => {
  const getAccessTokenResponse = {
    username: 'my-username',
    accessToken: 'my-access-token',
    refreshToken: 'my-refresh-token',
    expirationTime: 12345
  };
  const jwtToken = createJwtToken(getAccessTokenResponse);

  const stub = sinon.stub(
    EarthdataLoginClient.prototype,
    'getAccessToken'
  ).callsFake(async () => getAccessTokenResponse);

  const response = await request(app)
    .get('/token')
    .query({ code: 'my-authorization-code' })
    .set('Accept', 'application/json')
    .expect(200);

  t.is(response.status, 200);
  t.is(response.body.message.token, jwtToken);
  stub.restore();
});

test.serial('GET /token with a code and state results in a redirect to that state', async (t) => {
  const getAccessTokenResponse = fakeAccessTokenFactory();

  const stub = sinon.stub(
    EarthdataLoginClient.prototype,
    'getAccessToken'
  ).callsFake(async () => getAccessTokenResponse);

  const response = await request(app)
    .get('/token')
    .query({ code: 'my-authorization-code', state: 'http://www.example.com/state' })
    .set('Accept', 'application/json')
    .expect(307);

  t.is(response.status, 307);

  const locationHeader = new URL(response.headers.location);
  t.is(locationHeader.origin, 'http://www.example.com');
  t.is(locationHeader.pathname, '/state');
  stub.restore();
});

test.serial('GET /token with a code and state results in a redirect containing the access token', async (t) => {
  const getAccessTokenResponse = fakeAccessTokenFactory();
  const jwtToken = createJwtToken(getAccessTokenResponse);

  const stub = sinon.stub(
    EarthdataLoginClient.prototype,
    'getAccessToken'
  ).callsFake(async () => getAccessTokenResponse);

  const response = await request(app)
    .get('/token')
    .query({ code: 'my-authorization-code', state: 'http://www.example.com/state' })
    .set('Accept', 'application/json')
    .expect(307);

  t.is(response.status, 307);

  const locationHeader = new URL(response.headers.location);

  t.is(locationHeader.origin, 'http://www.example.com');
  t.is(locationHeader.pathname, '/state');
  t.is(locationHeader.searchParams.get('token'), jwtToken);
  stub.restore();
});

test.serial('When using Earthdata Login, GET /token with a code stores the access token in DynamoDb', async (t) => {
  const getAccessTokenResponse = fakeAccessTokenFactory();
  const { accessToken, refreshToken } = getAccessTokenResponse;

  const stub = sinon.stub(
    EarthdataLoginClient.prototype,
    'getAccessToken'
  ).callsFake(async () => getAccessTokenResponse);

  await request(app)
    .get('/token')
    .query({ code: 'my-authorization-code', state: 'http://www.example.com/state' })
    .set('Accept', 'application/json')
    .expect(307);

  const tokenAfter = await accessTokenModel.get({ accessToken });

  t.is(tokenAfter.accessToken, accessToken);
  t.is(tokenAfter.refreshToken, refreshToken);
  stub.restore();
});

test.serial('GET /refresh without a token results in an authorization failure response', async (t) => {
  const response = await request(app)
    .post('/refresh')
    .set('Accept', 'application/json')
    .expect(401);

  t.is(response.status, 401);
  t.is(response.body.message, 'Request requires a token');
});

test.serial('GET /refresh with an invalid token results in an authorization failure response', async (t) => {
  const response = await request(app)
    .post('/refresh')
    .set('Accept', 'application/json')
    .send({ token: 'InvalidToken' })
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.serial('GET /refresh with an non-existent token results in an authorization failure response', async (t) => {
  const userRecord = fakeUserFactory();
  await userModel.create(userRecord);

  const accessTokenRecord = fakeAccessTokenFactory({ username: userRecord.userName });
  const jwtToken = createJwtToken(accessTokenRecord);

  const response = await request(app)
    .post('/refresh')
    .set('Accept', 'application/json')
    .send({ token: jwtToken })
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.serial('GET /refresh with an unauthorized user results in an authorization failure response', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory();
  const jwtToken = createJwtToken(accessTokenRecord);

  const response = await request(app)
    .post('/refresh')
    .set('Accept', 'application/json')
    .send({ token: jwtToken })
    .expect(401);

  assertions.isUnauthorizedUserResponse(t, response);
});

test.serial('GET /refresh returns 500 if refresh token request fails', async (t) => {
  const stub = sinon.stub(
    EarthdataLoginClient.prototype,
    'refreshAccessToken'
  ).callsFake(async () => {
    throw new Error('Refresh token request failed');
  });

  const userRecord = fakeUserFactory();
  await userModel.create(userRecord);

  const initialTokenRecord = fakeAccessTokenFactory({ username: userRecord.userName });
  await accessTokenModel.create(initialTokenRecord);

  const requestJwtToken = createJwtToken(initialTokenRecord);

  const response = await request(app)
    .post('/refresh')
    .set('Accept', 'application/json')
    .send({ token: requestJwtToken })
    .expect(500);

  t.is(response.status, 500);
  stub.restore();
});

test.serial('GET /refresh with a valid token returns a refreshed token', async (t) => {
  const userRecord = fakeUserFactory();
  await userModel.create(userRecord);

  const initialTokenRecord = fakeAccessTokenFactory({ username: userRecord.userName });
  await accessTokenModel.create(initialTokenRecord);

  const requestJwtToken = createJwtToken(initialTokenRecord);


  const refreshedTokenRecord = fakeAccessTokenFactory();
  const refreshedJwtToken = createJwtToken(refreshedTokenRecord);

  const stub = sinon.stub(
    EarthdataLoginClient.prototype,
    'refreshAccessToken'
  ).callsFake(async () => refreshedTokenRecord);

  const response = await request(app)
    .post('/refresh')
    .set('Accept', 'application/json')
    .send({ token: requestJwtToken })
    .expect(200);

  t.is(response.status, 200);

  t.is(response.body.token, refreshedJwtToken);

  t.false(await accessTokenModel.exists({
    accessToken: initialTokenRecord.accessToken
  }));
  t.true(await accessTokenModel.exists({
    accessToken: refreshedTokenRecord.accessToken
  }));
  stub.restore();
});

test.serial('DELETE /tokenDelete without a token returns a 404 response', async (t) => {
  const response = await request(app)
    .delete('/token')
    .set('Accept', 'application/json')
    .expect(404);

  t.is(response.status, 404);
});

test.serial('DELETE /tokenDelete with an invalid token returns an invalid token response', async (t) => {
  const response = await request(app)
    .delete('/token/InvalidToken')
    .set('Accept', 'application/json')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.serial('DELETE /tokenDelete with an unauthorized user returns an unauthorized user response', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory();
  const jwtToken = createJwtToken(accessTokenRecord);

  const response = await request(app)
    .delete(`/token/${jwtToken}`)
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isUnauthorizedUserResponse(t, response);
});

test.serial('DELETE /tokenDelete with a valid token results in a successful deletion response', async (t) => {
  const userRecord = fakeUserFactory();
  await userModel.create(userRecord);

  const accessTokenRecord = fakeAccessTokenFactory({ username: userRecord.userName });
  await accessTokenModel.create(accessTokenRecord);

  const jwtToken = createJwtToken(accessTokenRecord);
  const response = await request(app)
    .delete(`/token/${jwtToken}`)
    .set('Accept', 'application/json')
    .expect(200);

  t.false(await accessTokenModel.exists({ accessToken: accessTokenRecord.accessToken }));
  t.is(response.status, 200);
  t.is(response.body.message, 'Token record was deleted');
});
