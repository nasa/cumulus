'use strict';

const test = require('ava');
const sinon = require('sinon');
const request = require('supertest');
const LaunchpadToken = require('../../common/LaunchpadToken');
const EsCollection = require('../es/collections');
const models = require('../models');
const assertions = require('../lib/assertions');
const { randomString } = require('@cumulus/common/test-utils');
process.env.cumulusUserGroup = 'GSFC-Cumulus';
process.env.LAUNCHPAD_AUTH = 'true';
process.env.AccessTokensTable = randomString();
process.env.system_bucket = randomString();
process.env.stackName = randomString();
const { app } = require('../app');

const validateTokenResponse = {
  owner_auid: randomString(),
  owner_groups: ['cn=GSFC-Cumulus,ou=252397,ou=ROLES,ou=Groups'],
  session_maxtimeout: 3600,
  session_starttime: 1564067402,
  status: 'success'
};

let accessTokenModel;
test.before(async () => {
  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
});

test.serial('API request with an valid token stores the access token', async (t) => {
  const stub = sinon.stub(LaunchpadToken.prototype, 'validateToken').returns(validateTokenResponse);
  const collectionStub = sinon.stub(EsCollection.prototype, 'query').returns([]);

  await request(app)
    .get('/collections')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ValidAccessToken1')
    .expect(200);

  stub.restore();
  collectionStub.restore();
  const accessToken = await accessTokenModel.get({accessToken: 'ValidAccessToken1'});
  t.is(accessToken.accessToken, 'ValidAccessToken1');
});

test.serial('API request with an invalid token returns an unauthorized response', async (t) => {
  const stub = sinon.stub(LaunchpadToken.prototype, 'validateToken').returns({status: 'failed'});

  const response = await request(app)
    .get('/collections')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  stub.restore();
  assertions.isInvalidAccessTokenResponse(t, response);
});

test.serial('API request with a stored non-expired token returns a successful response', async (t) => {
  const stub = sinon.stub(LaunchpadToken.prototype, 'validateToken').returns(validateTokenResponse);
  const collectionStub = sinon.stub(EsCollection.prototype, 'query').returns([]);

  await request(app)
    .get('/collections')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ValidAccessToken2')
    .expect(200);

  const accessToken = await accessTokenModel.get({accessToken: 'ValidAccessToken2'});
  t.is(accessToken.accessToken, 'ValidAccessToken2');

  await request(app)
    .get('/collections')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ValidAccessToken2')
    .expect(200);

    const accessToken1 = await accessTokenModel.get({accessToken: 'ValidAccessToken2'});
    t.is(accessToken1.accessToken, 'ValidAccessToken2');

  stub.restore();
  collectionStub.restore();
});

test.serial('API request with a stored expired token returns an expired response', async (t) => {
  const tokenResponse = {
    session_maxtimeout: 0,
    status: 'success',
    owner_groups: ['cn=GSFC-Cumulus,ou=252397,ou=ROLES,ou=Groups']
  }
  const stub = sinon.stub(LaunchpadToken.prototype, 'validateToken').returns(tokenResponse);
  const collectionStub = sinon.stub(EsCollection.prototype, 'query').returns([]);

  await request(app)
    .get('/collections')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ValidAccessToken3')
    .expect(200);

  const accessToken = await accessTokenModel.get({accessToken: 'ValidAccessToken3'});
  t.is(accessToken.accessToken, 'ValidAccessToken3');

  const response = await request(app)
    .get('/collections')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ValidAccessToken3')
    .expect(401);

  t.is(response.body.message, 'Access token has expired');
  stub.restore();
  collectionStub.restore();
});

test.serial('Request returns an unauthorized response when validation response does not contain user group', async (t) => {
  const tokenResponse = {
    session_maxtimeout: 3600,
    status: 'success',
    owner_groups: ['cn=NotCorrectGroup,ou=252397,ou=ROLES,ou=Groups']
  }
  const stub = sinon.stub(LaunchpadToken.prototype, 'validateToken').returns(tokenResponse);

  const response = await request(app)
    .get('/collections')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ValidAccessToken4')
    .expect(403);

  t.is(response.body.message, 'User not authorized');
  stub.restore();
});
