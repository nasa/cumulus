'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const nock = require('nock');
const rewire = require('rewire');
const sinon = require('sinon');
const S3 = require('@cumulus/aws-client/S3');
const {
  createBucket,
  fileExists,
  deleteS3Object,
  recursivelyDeleteS3Bucket,
  s3PutObject,
} = S3;

const LaunchpadToken = require('../LaunchpadToken');

const randomString = () => cryptoRandomString({ length: 10 });

const certificate = 'pki_certificate';
const bucket = randomString();
const stackName = randomString();
const api = 'https://www.example.com:12345/api/';
const lockFileKey = `${stackName}/launchpad/token-lock.json`;

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

const launchpad = rewire('..');
const {
  getLaunchpadToken,
  validateLaunchpadToken,
  getValidLaunchpadToken,
  generateNewLaunchpadToken,
  createLockFile,
  removeLockFile,
  waitForLockFileRelease,
} = launchpad;
const launchpadTokenBucketKey = launchpad.__get__('launchpadTokenBucketKey');

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

test.afterEach.always(async () => {
  const { Bucket, Key } = launchpadTokenBucketKey();
  await Promise.all([
    deleteS3Object(Bucket, lockFileKey),
    deleteS3Object(Bucket, Key),
  ]);
});

test.serial('createLockFile writes a lock file to S3', async (t) => {
  await createLockFile();
  t.truthy(await fileExists(bucket, lockFileKey));
});

test.serial('removeLockFile deletes the lock file from S3', async (t) => {
  await createLockFile();

  await removeLockFile();
  t.falsy(await fileExists(bucket, lockFileKey));
});

test.serial('isLockStale returns false for a fresh lock file', async (t) => {
  await createLockFile();
  const isLockStale = launchpad.__get__('isLockStale');
  t.false(await isLockStale());
});

test.serial('isLockStale returns false when no lock file exists', async (t) => {
  const isLockStale = launchpad.__get__('isLockStale');
  t.false(await isLockStale());
});

test.serial('isLockStale returns true when lock file is older than TTL', async (t) => {
  const isLockStale = launchpad.__get__('isLockStale');
  const headObjectStub = sinon.stub(S3, 'headObject').resolves({
    LastModified: new Date(Date.now() - 120 * 1000),
  });
  t.teardown(() => headObjectStub.restore());

  t.true(await isLockStale());
});

test.serial('waitForLockFileRelease resolves when the lock file is absent', async (t) => {
  const retries = 1;
  await t.notThrowsAsync(waitForLockFileRelease(retries));
});

test.serial('waitForLockFileRelease throws a timeout error when the lock file persists', async (t) => {
  const retries = 2;
  await createLockFile();

  await t.throwsAsync(
    waitForLockFileRelease(retries),
    { message: /Timed out waiting for launchpad token lock file removal/ }
  );
});

test.serial('waitForLockFileRelease propagates non-NotFound S3 errors without retrying', async (t) => {
  const headObjectStub = sinon.stub(S3, 'headObject').rejects(
    Object.assign(new Error('access denied'), { name: 'AccessDenied' })
  );
  t.teardown(() => headObjectStub.restore());

  await t.throwsAsync(waitForLockFileRelease(5), { message: 'access denied' });
  t.is(headObjectStub.callCount, 1);
});

test.serial('generateNewLaunchpadToken issues a valid token even when a cached token exists', async (t) => {
  const { Bucket, Key } = launchpadTokenBucketKey();

  await s3PutObject({
    Bucket,
    Key,
    Body: JSON.stringify({
      sm_token: 'invalid-token',
      session_maxtimeout: 3600,
      session_starttime: Date.now() / 1000,
    }),
  });

  const validToken = randomString();
  nock('https://www.example.com:12345')
    .get('/api/gettoken')
    .reply(200, JSON.stringify({ ...getTokenResponse, sm_token: validToken }));

  const result = await generateNewLaunchpadToken(config);
  t.is(result, validToken);
});

test.serial('generateNewLaunchpadToken handles NoSuchKey when no token file exists', async (t) => {
  const validToken = randomString();
  nock('https://www.example.com:12345')
    .get('/api/gettoken')
    .reply(200, JSON.stringify({ ...getTokenResponse, sm_token: validToken }));

  const result = await generateNewLaunchpadToken(config);
  t.is(result, validToken);
});

test.serial('generateNewLaunchpadToken rethrows non-NoSuchKey/NotFound errors from S3 delete', async (t) => {
  const stub = sinon.stub(S3, 'deleteS3Object').rejects(
    Object.assign(new Error('boom'), { name: 'AccessDenied' })
  );
  t.teardown(() => stub.restore());

  await t.throwsAsync(generateNewLaunchpadToken(config), { message: 'boom' });
});

test.serial('getValidLaunchpadToken waits and reads when a lock file already exists', async (t) => {
  const cachedToken = randomString();
  const { Bucket, Key } = launchpadTokenBucketKey();

  await s3PutObject({
    Bucket,
    Key,
    Body: JSON.stringify({
      sm_token: cachedToken,
      session_maxtimeout: 3600,
      session_starttime: Date.now() / 1000,
    }),
  });

  await s3PutObject({ Bucket, Key: lockFileKey });

  t.teardown(launchpad.__set__('waitForLockFileRelease', sinon.stub().resolves()));

  const result = await getValidLaunchpadToken(config);
  t.is(result, cachedToken);
});

test.serial('getValidLaunchpadToken creates the lock, generates a token, and removes the lock', async (t) => {
  const newToken = randomString();
  const createLockFileStub = sinon.stub().resolves();
  const removeLockFileStub = sinon.stub().resolves();
  const generateStub = sinon.stub().resolves(newToken);

  t.teardown(launchpad.__set__('createLockFile', createLockFileStub));
  t.teardown(launchpad.__set__('removeLockFile', removeLockFileStub));
  t.teardown(launchpad.__set__('generateNewLaunchpadToken', generateStub));

  const result = await getValidLaunchpadToken(config);

  t.is(result, newToken);
  t.true(createLockFileStub.calledOnce);
  t.true(generateStub.calledOnce);
  t.true(removeLockFileStub.calledOnce);
});

test.serial('getValidLaunchpadToken clears a stale lock and retries acquisition', async (t) => {
  const newToken = randomString();
  const createLockFileStub = sinon.stub();
  createLockFileStub.onFirstCall().rejects(
    Object.assign(new Error('locked'), { name: 'PreconditionFailed' })
  );
  createLockFileStub.onSecondCall().resolves();

  const isLockStaleStub = sinon.stub().resolves(true);
  const removeLockFileStub = sinon.stub().resolves();
  const generateStub = sinon.stub().resolves(newToken);

  t.teardown(launchpad.__set__('createLockFile', createLockFileStub));
  t.teardown(launchpad.__set__('isLockStale', isLockStaleStub));
  t.teardown(launchpad.__set__('removeLockFile', removeLockFileStub));
  t.teardown(launchpad.__set__('generateNewLaunchpadToken', generateStub));

  const result = await getValidLaunchpadToken(config);

  t.is(result, newToken);
  t.is(createLockFileStub.callCount, 2);
  t.true(isLockStaleStub.calledOnce);
  t.is(removeLockFileStub.callCount, 2);
});

test.serial('getValidLaunchpadToken falls back to wait-and-read when createLockFile races', async (t) => {
  const cachedToken = randomString();
  const { Bucket, Key } = launchpadTokenBucketKey();

  await s3PutObject({
    Bucket,
    Key,
    Body: JSON.stringify({
      sm_token: cachedToken,
      session_maxtimeout: 3600,
      session_starttime: Date.now() / 1000,
    }),
  });

  const removeLockFileStub = sinon.stub().resolves();

  t.teardown(launchpad.__set__(
    'createLockFile',
    sinon.stub().rejects(Object.assign(new Error('lost race'), { name: 'PreconditionFailed' }))
  ));
  t.teardown(launchpad.__set__('removeLockFile', removeLockFileStub));
  t.teardown(launchpad.__set__('waitForLockFileRelease', sinon.stub().resolves()));

  const result = await getValidLaunchpadToken(config);

  t.is(result, cachedToken);
  t.false(removeLockFileStub.called);
});

test.serial('getValidLaunchpadToken removes the lock file even when token generation throws', async (t) => {
  const removeLockFileStub = sinon.stub().resolves();

  t.teardown(launchpad.__set__('createLockFile', sinon.stub().resolves()));
  t.teardown(launchpad.__set__('removeLockFile', removeLockFileStub));
  t.teardown(launchpad.__set__('generateNewLaunchpadToken', sinon.stub().rejects(new Error('launchpad down'))));

  await t.throwsAsync(getValidLaunchpadToken(config), { message: 'launchpad down' });
  t.true(removeLockFileStub.calledOnce);
});

test.serial('getValidLaunchpadToken rethrows non-PreconditionFailed errors from createLockFile', async (t) => {
  t.teardown(launchpad.__set__('createLockFile', sinon.stub().rejects(new Error('s3 unreachable'))));
  t.teardown(launchpad.__set__('removeLockFile', sinon.stub().resolves()));

  await t.throwsAsync(getValidLaunchpadToken(config), { message: 's3 unreachable' });
});

test.serial('getValidLaunchpadToken waits and reads when a stale lock is reclaimed by another process', async (t) => {
  const cachedToken = randomString();
  const { Bucket, Key } = launchpadTokenBucketKey();

  await s3PutObject({
    Bucket,
    Key,
    Body: JSON.stringify({
      sm_token: cachedToken,
      session_maxtimeout: 3600,
      session_starttime: Date.now() / 1000,
    }),
  });

  const createLockFileStub = sinon.stub().rejects(
    Object.assign(new Error('locked'), { name: 'PreconditionFailed' })
  );

  t.teardown(launchpad.__set__('createLockFile', createLockFileStub));
  t.teardown(launchpad.__set__('isLockStale', sinon.stub().resolves(true)));
  t.teardown(launchpad.__set__('removeLockFile', sinon.stub().resolves()));
  t.teardown(launchpad.__set__('waitForLockFileRelease', sinon.stub().resolves()));

  const result = await getValidLaunchpadToken(config);

  t.is(result, cachedToken);
  t.is(createLockFileStub.callCount, 2);
});

test.serial('LaunchpadToken.requestToken returns token', async (t) => {
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

test.serial('getLaunchpadToken does not update the token in s3 if the token has been updated by another thread', async (t) => {
  const stubS3Token = randomString();
  const getValidLaunchpadTokenFromS3Stub = sinon.stub();
  getValidLaunchpadTokenFromS3Stub.onCall(0).returns(undefined);
  getValidLaunchpadTokenFromS3Stub.onCall(1).returns(stubS3Token);

  const revert = launchpad.__set__('getValidLaunchpadTokenFromS3', getValidLaunchpadTokenFromS3Stub);

  const firstToken = randomString();
  const secondToken = randomString();

  nock('https://www.example.com:12345')
    .get('/api/gettoken')
    .reply(200,
      JSON.stringify({ ...getTokenResponse, sm_token: firstToken }));

  // does not update the token if token has been updated since
  const tokenReturnWithStubFunc = await launchpad.getLaunchpadToken(config);
  t.is(tokenReturnWithStubFunc, stubS3Token);
  t.not(tokenReturnWithStubFunc, firstToken);

  // restore the original function
  revert();
  nock('https://www.example.com:12345')
    .get('/api/gettoken')
    .reply(200,
      JSON.stringify({ ...getTokenResponse, sm_token: secondToken }));
  // token is updated
  const tokenReturned = await launchpad.getLaunchpadToken(config);
  t.is(tokenReturned, secondToken);
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
