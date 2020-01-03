'use strict';

const test = require('ava');
const rewire = require('rewire');
const express = require('express');
const boom = require('express-boom');
const request = require('supertest');
const { randomString } = require('@cumulus/common/test-utils');

const { AccessToken, User } = require('../../models');
const { fakeAccessTokenFactory } = require('../../lib/testUtils');
const token = require('../../lib/token');

const auth = rewire('../../app/auth');
const { ensureAuthorized } = auth;

const createJwtToken = (params = {}) =>
  token.createJwtToken({
    accessToken: randomString(),
    expirationTime: Date.now() + (10 * 1000),
    username: randomString(),
    ...params
  });

test.before(async (t) => {
  process.env.TOKEN_SECRET = randomString();

  process.env.AccessTokensTable = randomString();
  t.context.accessTokenModel = new AccessToken();
  await t.context.accessTokenModel.createTable();

  process.env.UsersTable = randomString();
  t.context.userModel = new User();
  await t.context.userModel.createTable();

  t.context.ensureAuthorizedApp = express();
  t.context.ensureAuthorizedApp.use(boom());
  t.context.ensureAuthorizedApp.get(
    '/asdf',
    ensureAuthorized,
    (_req, res) => res.status(200).json({ name: 'John Gillespie Magee Jr.' })
  );
});

test.after.always(async (t) => {
  const { accessTokenModel, userModel } = t.context;

  await accessTokenModel.deleteTable();
  await userModel.deleteTable();
});

test.serial('ensureAuthorized() with a valid oauth jwtToken succeeds', async (t) => {
  const { accessTokenModel, ensureAuthorizedApp, userModel } = t.context;

  const accessToken = fakeAccessTokenFactory();
  await accessTokenModel.create(accessToken);

  const jwtToken = createJwtToken(accessToken);

  await userModel.create({ userName: accessToken.username });

  process.env.OAUTH_PROVIDER = 'earthdata';

  await request(ensureAuthorizedApp)
    .get('/asdf')
    .set('Authorization', `Bearer ${jwtToken}`)
    .then((res) => {
      t.is(res.statusCode, 200);
    });
});

test('ensureAuthorized() returns an unauthorized response if an authorization header is not set', async (t) => {
  const { ensureAuthorizedApp } = t.context;

  await request(ensureAuthorizedApp)
    .get('/asdf')
    .then((res) => {
      t.is(res.statusCode, 401);
      const body = JSON.parse(res.text);
      t.is(body.message, 'Authorization header missing');
    });
});

test('ensureAuthorized() returns an unauthorized response if an authorization scheme is not "Bearer"', async (t) => {
  const { ensureAuthorizedApp } = t.context;

  await request(ensureAuthorizedApp)
    .get('/asdf')
    .set('Authorization', 'Basic asdf')
    .then((res) => {
      t.is(res.statusCode, 401);
      const body = JSON.parse(res.text);
      t.is(body.message, 'Authorization scheme must be Bearer');
    });
});

test('ensureAuthorized() returns an unauthorized response if the token is missing', async (t) => {
  const { ensureAuthorizedApp } = t.context;

  await request(ensureAuthorizedApp)
    .get('/asdf')
    .set('Authorization', 'Bearer')
    .then((res) => {
      t.is(res.statusCode, 401);
      const body = JSON.parse(res.text);
      t.is(body.message, 'Missing token');
    });
});

test.serial('ensureAuthorized() verifies that the user is authorized when not using Launchpad authentication', async (t) => {
  const { ensureAuthorizedApp } = t.context;

  process.env.OAUTH_PROVIDER = 'earthdata';

  const jwtToken = createJwtToken();

  await request(ensureAuthorizedApp)
    .get('/asdf')
    .set('Authorization', `Bearer ${jwtToken}`)
    .then((res) => {
      t.is(res.statusCode, 401);
      const body = JSON.parse(res.text);
      t.is(body.message, 'User not authorized');
    });
});

test.serial('If Launchpad authentication is enabled, and the Bearer token is not a valid JWT token, ensureAuthorized() passes the authentication over to ensureLaunchpadAPIAuthorized()', async (t) => {
  const { ensureAuthorizedApp } = t.context;

  const launchpadToken = randomString();
  const expectedAuthorizationToken = `Bearer ${launchpadToken}`;

  process.env.OAUTH_PROVIDER = 'launchpad';

  let wasEnsureLaunchpadAPIAuthorizedCalled = false;

  await auth.__with__({
    ensureLaunchpadAPIAuthorized: async (req, _res, next) => {
      t.is(req.headers.authorization, expectedAuthorizationToken);
      wasEnsureLaunchpadAPIAuthorizedCalled = true;
      return next();
    }
  })(
    () =>
      request(ensureAuthorizedApp)
        .get('/asdf')
        .set('Authorization', expectedAuthorizationToken)
        .then((res) => {
          t.is(res.statusCode, 200);
          t.true(wasEnsureLaunchpadAPIAuthorizedCalled);
        })
  );
});

test.serial('ensureAuthorized() returns unauthorized if the token has expired', async (t) => {
  const { accessTokenModel, ensureAuthorizedApp, userModel } = t.context;

  const accessToken = fakeAccessTokenFactory({
    expirationTime: Date.now() - (10 * 1000)
  });
  await accessTokenModel.create(accessToken);

  const jwtToken = createJwtToken(accessToken);

  await userModel.create({ userName: accessToken.username });

  process.env.OAUTH_PROVIDER = 'earthdata';

  await request(ensureAuthorizedApp)
    .get('/asdf')
    .set('Authorization', `Bearer ${jwtToken}`)
    .then((res) => {
      t.is(res.statusCode, 401);
      const body = JSON.parse(res.text);
      t.is(body.message, 'Access token has expired');
    });
});

test.serial('If Launchpad authentication is not enabled, and the Bearer token is not a valid JWT token, ensureAuthorized() returns a forbidden response', async (t) => {
  const { ensureAuthorizedApp } = t.context;

  process.env.OAUTH_PROVIDER = 'earthdata';

  await request(ensureAuthorizedApp)
    .get('/asdf')
    .set('Authorization', `Bearer ${randomString()}`)
    .then((res) => {
      t.is(res.statusCode, 403);
      const body = JSON.parse(res.text);
      t.is(body.message, 'Invalid access token');
    });
});
