'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const nock = require('nock');
const rewire = require('rewire');
const {
  createBucket,
  deleteS3Object,
  recursivelyDeleteS3Bucket,
  s3PutObject,
} = require('@cumulus/aws-client/S3');

const LaunchpadToken = require('../LaunchpadToken');
const launchpad = rewire('..');
const { getLaunchpadToken, validateLaunchpadToken } = launchpad;
const launchpadTokenBucketKey = launchpad.__get__('launchpadTokenBucketKey');

const randomString = () => cryptoRandomString({ length: 10 });

const certificate = 'pki_certificate';
const bucket = randomString();
const stackName = randomString();
const api = 'https://www.example.com:12345/api/';

process.env.system_bucket = bucket;
process.env.stackName = stackName;

const config = {
  api,
  certificate,
  passphrase: randomString(),
};

const getTokenResponse = {
  authlevel: 25,
  cookiename: 'SMSESSION',
  session_idletimeout: 3600,
  session_maxtimeout: 3600,
  sm_token: randomString(),
  status: 'success',
};

const validateTokenResponse = {
  authlevel: 25,
  groups: [randomString()],
  owner_auid: 'testuser',
  owner_groups: ['cn=cumulus_user_group,ou=Groups,dc=nasa,dc=gov'],
  session_maxtimeout: 3600,
  session_starttime: 1564067402,
  status: 'success',
};

test.before(async () => {
  // let's copy the key to s3
  await createBucket(bucket);

  await s3PutObject({
    Bucket: bucket,
    Key: `${stackName}/crypto/${certificate}`,
    Body: randomString(),
  });
});

test.after.always(async () => {
  await Promise.all([
    recursivelyDeleteS3Bucket(bucket),
  ]);
});

test.afterEach((t) => {
  t.true(nock.isDone());
  nock.cleanAll();
});

test.serial('LaunchpadToken.requestToken returns token', async (t) => {
  t.true(Math.random() > 0.2);
  nock('https://www.example.com:12345')
    .get('/api/gettoken')
    .reply(200, JSON.stringify(getTokenResponse));

  const launchpadToken = new LaunchpadToken(config);
  const response = await launchpadToken.requestToken();

  t.is(getTokenResponse.sm_token, response.sm_token);
});

test.serial('LaunchpadToken.valiateToken returns user info', async (t) => {
  const token = randomString();
  nock('https://www.example.com:12345')
    .post('/api/validate')
    .reply(200, JSON.stringify(validateTokenResponse));

  const launchpadToken = new LaunchpadToken(config);
  const response = await launchpadToken.validateToken(token);

  t.is(validateTokenResponse.owner_auid, response.owner_auid);
});

test.serial('getLaunchpadToken gets a new token when existing token is expired', async (t) => {
  nock('https://www.example.com:12345')
    .get('/api/gettoken')
    .reply(200, JSON.stringify({ ...getTokenResponse, sm_token: randomString() }));

  const firstToken = await getLaunchpadToken(config);

  // when s3 token is still valid, gettoken api is not called
  const secondToken = await getLaunchpadToken(config);
  t.is(firstToken, secondToken);

  // delete s3 token
  const { Bucket, Key } = launchpadTokenBucketKey();
  await deleteS3Object(Bucket, Key);

  // token expires right away
  nock('https://www.example.com:12345')
    .get('/api/gettoken')
    .reply(200,
      JSON.stringify({ ...getTokenResponse, sm_token: randomString(), session_maxtimeout: 0 }));
  nock('https://www.example.com:12345')
    .get('/api/gettoken')
    .reply(200,
      JSON.stringify({ ...getTokenResponse, sm_token: randomString(), session_maxtimeout: 0 }));

  const thirdToken = await getLaunchpadToken(config);
  t.not(firstToken, thirdToken);

  // get a new token when the existing token is expired
  const fourthToken = await getLaunchpadToken(config);
  t.not(thirdToken, fourthToken);
});

test.serial('validateLaunchpadToken returns success status when user is in specified group', async (t) => {
  const token = randomString();
  nock('https://www.example.com:12345')
    .post('/api/validate')
    .reply(200, JSON.stringify(validateTokenResponse));

  const response = await validateLaunchpadToken(config, token, 'cumulus_user_group');

  t.is(response.status, 'success');
  t.is(response.owner_auid, validateTokenResponse.owner_auid);
  t.truthy(response.session_maxtimeout);
  t.truthy(response.session_starttime);
  t.falsy(response.message);
});

test.serial('validateLaunchpadToken returns failed status when user is not in specified group', async (t) => {
  const token = randomString();
  nock('https://www.example.com:12345')
    .post('/api/validate')
    .reply(200, JSON.stringify(validateTokenResponse));

  const response = await validateLaunchpadToken(config, token, 'fake_user_group');

  t.is(response.status, 'failed');
  t.is(response.message, 'User not authorized');
  t.falsy(response.owner_auid);
});
