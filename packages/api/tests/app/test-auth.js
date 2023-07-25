const test = require('ava');
const request = require('supertest');
const moment = require('moment');

const { createBucket, putJsonS3Object } = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');

const { app } = require('../../app');
const { createJwtToken } = require('../../lib/token');
const { fakeAccessTokenFactory } = require('../../lib/testUtils');
const AccessToken = require('../../lib/access-tokens');

let accessTokenModel;
const validUsername = randomId('user');

test.before(async () => {
  process.env.OAUTH_PROVIDER = 'earthdata';
  process.env.TOKEN_SECRET = 'foobar';
  process.env.system_bucket = randomId('bucket');
  process.env.stackName = randomId('stack');

  process.env.AccessTokensTable = randomId('token');
  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  await createBucket(process.env.system_bucket);
  await putJsonS3Object(
    process.env.system_bucket,
    `${process.env.stackName}/api/authorized_oauth_users.json`,
    [validUsername]
  );
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
});

test('API request with valid JWT returns 200 response', async (t) => {
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

test('API request with JWT for unauthorized user returns 401 response', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory();
  await accessTokenModel.create(accessTokenRecord);

  const jwt = createJwtToken(accessTokenRecord);

  const response = await request(app)
    .get('/workflows')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwt}`)
    .expect(401);
  t.is(response.status, 401);
  t.is(response.body.message, 'User not authorized');
});

test('API request with expired JWT returns 401 response', async (t) => {
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
  t.is(response.body.message, 'Access token has expired');
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
  t.is(response.body.message, 'Invalid access token');
});

test('API request with JWT and no corresponding token record returns 401 response', async (t) => {
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
