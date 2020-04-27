'use strict';

const test = require('ava');
const sinon = require('sinon');
const request = require('supertest');
const moment = require('moment');

const { secretsManager } = require('@cumulus/aws-client/services');
const launchpad = require('@cumulus/launchpad-auth');
const { randomId } = require('@cumulus/common/test-utils');

const EsCollection = require('../../es/collections');
const models = require('../../models');
const assertions = require('../../lib/assertions');
const { app } = require('../../app');

const validateTokenResponse = {
  owner_auid: randomId('owner_auid'),
  session_maxtimeout: 3600,
  session_starttime: 1564067402,
  status: 'success'
};

let accessTokenModel;

test.before(async () => {
  process.env.oauth_user_group = 'GSFC-Cumulus';
  process.env.OAUTH_PROVIDER = 'launchpad';
  process.env.AccessTokensTable = randomId('AccessTokens');
  process.env.system_bucket = randomId('bucket');
  process.env.stackName = randomId('stack');

  process.env.ES_INDEX = randomId();
  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  // Store the launchpad passphrase
  process.env.launchpad_passphrase_secret_name = randomId('launchpad-secret-name');
  await secretsManager().createSecret({
    Name: process.env.launchpad_passphrase_secret_name,
    SecretString: randomId('launchpad-passphrase')
  }).promise();
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();

  await secretsManager().deleteSecret({
    SecretId: process.env.launchpad_passphrase_secret_name,
    ForceDeleteWithoutRecovery: true
  }).promise();
});

test.serial('API request with an valid token stores the access token', async (t) => {
  const stub = sinon.stub(launchpad, 'validateLaunchpadToken').returns(validateTokenResponse);
  const collectionStub = sinon.stub(EsCollection.prototype, 'query').returns([]);

  try {
    await request(app)
      .get('/collections')
      .set('Accept', 'application/json')
      .set('Authorization', 'Bearer ValidAccessToken1')
      .expect(200);
    const record = await accessTokenModel.get({ accessToken: 'ValidAccessToken1' });
    t.is(record.accessToken, 'ValidAccessToken1');
  } finally {
    stub.restore();
    collectionStub.restore();
  }
});

test.serial('API request with an invalid token returns an unauthorized response', async (t) => {
  const tokenResponse = {
    message: 'Invalid access token',
    status: 'failed'
  };

  const stub = sinon.stub(launchpad, 'validateLaunchpadToken')
    .resolves(tokenResponse);

  try {
    const response = await request(app)
      .get('/collections')
      .set('Accept', 'application/json')
      .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
      .expect(403);

    assertions.isInvalidAccessTokenResponse(t, response);
  } finally {
    stub.restore();
  }
});

test.serial('API request with a stored non-expired token returns a successful response', async (t) => {
  let stub = sinon.stub(launchpad, 'validateLaunchpadToken').resolves(validateTokenResponse);
  const collectionStub = sinon.stub(EsCollection.prototype, 'query').returns([]);

  try {
    await request(app)
      .get('/collections')
      .set('Accept', 'application/json')
      .set('Authorization', 'Bearer ValidAccessToken2')
      .expect(200);

    const accessToken = await accessTokenModel.get({ accessToken: 'ValidAccessToken2' });
    t.is(accessToken.accessToken, 'ValidAccessToken2');

    stub.restore();
    stub = sinon.stub(launchpad, 'validateLaunchpadToken').resolves({ status: 'failed' });

    await request(app)
      .get('/collections')
      .set('Accept', 'application/json')
      .set('Authorization', 'Bearer ValidAccessToken2')
      .expect(200);

    const accessToken1 = await accessTokenModel.get({ accessToken: 'ValidAccessToken2' });
    t.is(accessToken1.accessToken, 'ValidAccessToken2');
  } finally {
    stub.restore();
    collectionStub.restore();
  }
});

test.serial('API request with a stored expired token returns an expired response', async (t) => {
  const collectionStub = sinon.stub(EsCollection.prototype, 'query').returns([]);

  try {
    await accessTokenModel.create({
      accessToken: 'ValidAccessToken3',
      expirationTime: moment().unix()
    });

    const response = await request(app)
      .get('/collections')
      .set('Accept', 'application/json')
      .set('Authorization', 'Bearer ValidAccessToken3')
      .expect(401);

    t.is(response.body.message, 'Access token has expired');
  } finally {
    collectionStub.restore();
  }
});

test.serial('Request returns an unauthorized response when validation response does not contain user group', async (t) => {
  const tokenResponse = {
    message: 'User not authorized',
    status: 'failed'
  };

  const stub = sinon.stub(launchpad, 'validateLaunchpadToken').resolves(tokenResponse);

  try {
    const response = await request(app)
      .get('/collections')
      .set('Accept', 'application/json')
      .set('Authorization', 'Bearer ValidAccessToken4')
      .expect(403);

    t.is(response.body.message, 'User not authorized');
  } finally {
    stub.restore();
  }
});

test.serial('Non-Launchpad protected API explicitly disallows valid Launchpad tokens.', async (t) => {
  const stub = sinon.stub(launchpad, 'validateLaunchpadToken').returns(validateTokenResponse);
  process.env.OAUTH_PROVIDER = 'earthdata';

  try {
    const response = await request(app)
      .get('/collections')
      .set('Accept', 'application/json')
      .set('Authorization', 'Bearer ValidAccessToken1')
      .expect(403);

    t.is(response.body.message, 'Invalid access token');
  } finally {
    stub.restore();
    process.env.OAUTH_PROVIDER = 'launchpad';
  }
});
