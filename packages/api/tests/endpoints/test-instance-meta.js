'use strict';

const test = require('ava');
const request = require('supertest');
const { randomString } = require('@cumulus/common/test-utils');
const assertions = require('../../lib/assertions');
const models = require('../../models');
const {
  createFakeJwtAuthToken,
  fakeAccessTokenFactory
} = require('../../lib/testUtils');
const {
  createJwtToken
} = require('../../lib/token');

const CMR_ENVIRONMENT = randomString();
const CMR_PROVIDER = randomString();
process.env.CMR_ENVIRONMENT = CMR_ENVIRONMENT;
process.env.cmr_provider = CMR_PROVIDER;
process.env.TOKEN_SECRET = randomString();
let accessTokenModel;
let userModel;
let jwtAuthToken;

// import the express app after setting the env variables
const { app } = require('../../app');

test.before(async () => {
  process.env.UsersTable = randomString();
  userModel = new models.User();
  await userModel.createTable();

  process.env.AccessTokensTable = randomString();
  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });
});

test.after.always(async () => {
  await userModel.deleteTable();
  await accessTokenModel.deleteTable();
});

test('GET returns expected metadata', async (t) => {
  const response = await request(app)
    .get('/instanceMeta')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.deepEqual(response.body, {
    cmr: {
      provider: CMR_PROVIDER,
      environment: CMR_ENVIRONMENT
    }
  });
});

test('GET with invalid access token returns an invalid token response', async (t) => {
  const response = await request(app)
    .get('/instanceMeta')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test('GET with unauthorized user token returns an unauthorized user response', async (t) => {
  const accessTokenRecord = await accessTokenModel.create(fakeAccessTokenFactory());
  const requestToken = createJwtToken(accessTokenRecord);

  const response = await request(app)
    .get('/instanceMeta')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${requestToken}`)
    .expect(401);

  assertions.isInvalidAuthorizationResponse(t, response);
});

test('GET without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/instanceMeta')
    .set('Accept', 'application/json')
    .expect(401);
  assertions.isAuthorizationMissingResponse(t, response);
});
