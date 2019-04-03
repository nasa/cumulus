'use strict';

const request = require('supertest');
const test = require('ava');

const { randomString } = require('@cumulus/common/test-utils');

const models = require('../../models');
const assertions = require('../../lib/assertions');
const {
  createFakeJwtAuthToken
} = require('../../lib/testUtils');

process.env.AccessTokensTable = randomString();
process.env.UsersTable = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../app');

let jwtAuthToken;
let accessTokenModel;
let userModel;

test.before(async () => {
  userModel = new models.User();
  await userModel.createTable();

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await userModel.deleteTable();
});

test('PUT snapshot without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .put('/elasticsearch/create-snapshot')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('PUT snapshot with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .put('/elasticsearch/create-snapshot')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

// test('PUT snapshot', async (t) => {
//   const response = await request(app)
//     .put('/elasticsearch/create-snapshot')
//     .set('Accept', 'application/json')
//     .set('Authorization', `Bearer ${jwtAuthToken}`)
//     .expect(200);
// });

