'use strict';

const test = require('ava');
const nock = require('nock');
const {
  recursivelyDeleteS3Bucket,
  s3,
  s3PutObject
} = require('../aws');
const { randomString } = require('../test-utils');

const { LaunchpadToken } = require('../launchpad-token');

const certificate = 'pki_contificate';
const bucket = randomString();
const stackName = randomString();
const api = 'https://www.example.com:12345/api/';

process.env.system_bucket = bucket;
process.env.stackName = stackName;

const config = {
  api,
  encrypted: false,
  certificate,
  passphrase: randomString()
};

const getTokenResponse = {
  authlevel: 25,
  cookiename: 'SMSESSION',
  session_idletimeout: 3600,
  session_maxtimeout: 3600,
  sm_token: randomString(),
  status: 'success'
};

const validateTokenResponse = {
  authlevel: 25,
  groups: [randomString()],
  owner_auid: randomString(),
  owner_groups: [randomString()],
  session_maxtimeout: 3600,
  session_starttime: 1564067402,
  status: 'success'
};

test.before(async () => {
  // let's copy the key to s3
  await s3().createBucket({ Bucket: bucket }).promise();

  await s3PutObject({
    Bucket: bucket,
    Key: `${stackName}/crypto/${certificate}`,
    Body: randomString()
  });
});

test.after.always(async () => {
  await Promise.all([
    recursivelyDeleteS3Bucket(bucket)
  ]);
});

test('requestToken returns token', async (t) => {
  nock('https://www.example.com:12345')
    .get('/api/gettoken')
    .reply(200, JSON.stringify(getTokenResponse));

  const launchpadToken = new LaunchpadToken(config);
  const response = await launchpadToken.requestToken();

  t.is(getTokenResponse.sm_token, response.sm_token);
});

test('valiateToken returns user info', async (t) => {
  const token = randomString();
  nock('https://www.example.com:12345')
    .post('/api/validate')
    .reply(200, JSON.stringify(validateTokenResponse));

  const launchpadToken = new LaunchpadToken(config);
  const response = await launchpadToken.validateToken(token);

  t.is(validateTokenResponse.owner_auid, response.owner_auid);
});
