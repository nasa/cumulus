'use strict';

const test = require('ava');
const request = require('supertest');
const { randomString } = require('@cumulus/common/test-utils');

const models = require('../../models');
const assertions = require('../../lib/assertions');

process.env.AccessTokensTable = randomString();
process.env.UsersTable = randomString();

// import the express app after setting the env variables
const { app } = require('../../app');

let userModel;
test.before(async () => {
  userModel = new models.User();
  await userModel.createTable();
});

test.after.always(() => userModel.deleteTable());

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/stats')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-911 GET /stats/histogram without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/stats/histogram')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-911 GET /stats/aggregate without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/stats/aggregate')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-911 GET /stats/average without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/stats/average')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 GET without pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/stats/')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 GET without pathParameters and with an unauthorized user returns an unauthorized response');

test('CUMULUS-912 GET /stats/histogram with an unauthorized user returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/stats/histogram')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test('CUMULUS-912 GET /stats/aggregate with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/stats/aggregate')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test('CUMULUS-912 GET /stats/average with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/stats/average')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});
