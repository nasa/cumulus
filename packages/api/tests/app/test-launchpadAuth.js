'use strict';

const test = require('ava');
const sinon = require('sinon');
const request = require('supertest');
const moment = require('moment');

const { secretsManager } = require('@cumulus/aws-client/services');
const { createBucket, putJsonS3Object } = require('@cumulus/aws-client/S3');
const launchpad = require('@cumulus/launchpad-auth');
const { randomId } = require('@cumulus/common/test-utils');

const EsCollection = require('@cumulus/es-client/collections');
const models = require('../../models');
const { createJwtToken } = require('../../lib/token');
const { fakeAccessTokenFactory } = require('../../lib/testUtils');
const { app } = require('../../app');

const validateTokenResponse = {
  owner_auid: randomId('owner_auid'),
  session_maxtimeout: 3600,
  session_starttime: 1564067402,
  status: 'success',
};
const validUsername = randomId('user');

let accessTokenModel;

test.before(async () => {
  process.env.oauth_user_group = 'GSFC-Cumulus';
  process.env.OAUTH_PROVIDER = 'launchpad';
  process.env.AccessTokensTable = randomId('AccessTokens');
  process.env.system_bucket = randomId('bucket');
  process.env.stackName = randomId('stack');
  process.env.ES_INDEX = randomId();
  process.env.TOKEN_SECRET = 'foobar';

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  // Store the launchpad passphrase
  process.env.launchpad_passphrase_secret_name = randomId('launchpad-secret-name');
  await secretsManager().createSecret({
    Name: process.env.launchpad_passphrase_secret_name,
    SecretString: randomId('launchpad-passphrase'),
  });

  await createBucket(process.env.system_bucket);
  await putJsonS3Object(
    process.env.system_bucket,
    `${process.env.stackName}/api/authorized_oauth_users.json`,
    [validUsername]
  );
});

test.after.always(async () => {
  delete process.env.oauth_user_group;
  delete process.env.OAUTH_PROVIDER;
  delete process.env.AccessTokensTable;
  delete process.env.system_bucket;
  delete process.env.stackName;
  delete process.env.ES_INDEX;
  delete process.env.TOKEN_SECRET;

  await accessTokenModel.deleteTable();

  await secretsManager().deleteSecret({
    SecretId: process.env.launchpad_passphrase_secret_name,
    ForceDeleteWithoutRecovery: true,
  });
});

test.serial('API request with a valid Launchpad token stores the access token', async (t) => {
  const stub = sinon.stub(launchpad, 'validateLaunchpadToken').returns(validateTokenResponse);
  const collectionStub = sinon.stub(EsCollection.prototype, 'query').returns([]);

  try {
    await request(app)
      .get('/collections')
      .set('Accept', 'application/json')
      .set('Authorization', 'Bearer ValidAccessToken1')
      .expect(400);
    const record = await accessTokenModel.get({ accessToken: 'ValidAccessToken1' });
    t.is(record.accessToken, 'ValidAccessToken1');
  } finally {
    stub.restore();
    collectionStub.restore();
  }
});

test.serial('API request with an invalid Launchpad token returns a 403 unauthorized response', async (t) => {
  const tokenResponse = {
    message: 'Invalid access token',
    status: 'failed',
  };

  const stub = sinon.stub(launchpad, 'validateLaunchpadToken')
    .resolves(tokenResponse);

  try {
    const response = await request(app)
      .get('/collections')
      .set('Accept', 'application/json')
      .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
      .expect(403);

    t.is(response.status, 403);
    t.is(response.body.message, 'Invalid access token');
  } finally {
    stub.restore();
  }
});

test.serial('API request with a stored non-expired Launchpad token record returns a successful response', async (t) => {
  let stub = sinon.stub(launchpad, 'validateLaunchpadToken').resolves(validateTokenResponse);
  const collectionStub = sinon.stub(EsCollection.prototype, 'query').returns([]);

  try {
    await request(app)
      .get('/collections')
      .set('Accept', 'application/json')
      .set('Authorization', 'Bearer ValidAccessToken2')
      .expect(400);

    const accessToken = await accessTokenModel.get({ accessToken: 'ValidAccessToken2' });
    t.is(accessToken.accessToken, 'ValidAccessToken2');

    stub.restore();
    stub = sinon.stub(launchpad, 'validateLaunchpadToken').resolves({ status: 'failed' });

    await request(app)
      .get('/collections')
      .set('Accept', 'application/json')
      .set('Authorization', 'Bearer ValidAccessToken2')
      .expect(400);

    const accessToken1 = await accessTokenModel.get({ accessToken: 'ValidAccessToken2' });
    t.is(accessToken1.accessToken, 'ValidAccessToken2');
  } finally {
    stub.restore();
    collectionStub.restore();
  }
});

test.serial('API request with an expired Launchpad token returns a 401 response', async (t) => {
  const collectionStub = sinon.stub(EsCollection.prototype, 'query').returns([]);

  try {
    await accessTokenModel.create({
      accessToken: 'ValidAccessToken3',
      expirationTime: moment().unix(),
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

test.serial('API request returns a 403 unauthorized response when Launchpad validation response does not contain user group', async (t) => {
  const tokenResponse = {
    message: 'User not authorized',
    status: 'failed',
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
      .expect(401);
    t.is(response.body.message, 'Invalid access token');
  } finally {
    stub.restore();
    process.env.OAUTH_PROVIDER = 'launchpad';
  }
});

test.serial('API request with valid JWT returns 200 response', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory({
    username: validUsername,
  });
  await accessTokenModel.create(accessTokenRecord);

  const jwt = createJwtToken(accessTokenRecord);

  const response = await request(app)
    .get('/workflows')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwt}`)
    .expect(200);
  t.is(response.status, 200);
});

test.serial('API request with expired JWT returns 401 response', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory({
    expirationTime: moment().unix(),
    username: validUsername,
  });
  await accessTokenModel.create(accessTokenRecord);

  const jwt = createJwtToken(accessTokenRecord);

  const response = await request(app)
    .get('/workflows')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwt}`)
    .expect(401);
  t.is(response.status, 401);
});

test.serial('API request with invalid JWT returns 401 response', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory({
    username: validUsername,
  });
  await accessTokenModel.create(accessTokenRecord);

  // Use bad secret value to generate invalid JWT
  const tokenSecret = process.env.TOKEN_SECRET;
  process.env.TOKEN_SECRET = 'badsecret';
  const jwt = createJwtToken(accessTokenRecord);
  process.env.TOKEN_SECRET = tokenSecret;

  const response = await request(app)
    .get('/workflows')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwt}`)
    .expect(401);
  t.is(response.status, 401);
});

test.serial('API request with JWT and no corresponding token record returns 401 response', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory({
    username: validUsername,
  });

  const jwt = createJwtToken(accessTokenRecord);

  const response = await request(app)
    .get('/workflows')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwt}`)
    .expect(401);
  t.is(response.status, 401);
  t.is(response.body.message, 'User not authorized');
});
