'use strict';

const test = require('ava');
const sinon = require('sinon');
const rewire = require('rewire');
const S3 = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const launchpad = require('@cumulus/launchpad-auth');

process.env.system_bucket = randomString();

const recreateLaunchpadToken = rewire('../../lambdas/recreate-launchpad-token');

const {
  handler,
  generateLaunchpadToken,
  lockFileExists,
  createLockFile,
  putTokenInS3,
  removeLockFile,
} = recreateLaunchpadToken;

test.before(async () => {
  await S3.createBucket(process.env.system_bucket);
});

test.after.always(async () => {
  await S3.recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.serial('generateLaunchpadToken calls launchpad with correct config', async (t) => {
  const fakeToken = 'fake-launchpad-token';
  const fakePassphrase = 'fake-passphrase';

  const getLaunchpadTokenStub = sinon.stub(launchpad, 'getLaunchpadToken').resolves(fakeToken);
  const getSecretStringStub = sinon.stub().resolves(fakePassphrase);
  const revert = recreateLaunchpadToken.__set__('getSecretString', getSecretStringStub);

  t.teardown(() => {
    getLaunchpadTokenStub.restore();
    revert();
  });

  const config = {
    passphraseSecretName: 'my-secret',
    api: 'https://launchpad.example.com',
    certificate: 'my-cert',
  };

  const token = await generateLaunchpadToken(config);

  t.is(token, fakeToken);
  t.true(getSecretStringStub.calledWith('my-secret'));
  t.deepEqual(getLaunchpadTokenStub.firstCall.args[0], {
    passphrase: fakePassphrase,
    api: 'https://launchpad.example.com',
    certificate: 'my-cert',
  });
});

test.serial('generateLaunchpadToken falls back to env vars when config is empty', async (t) => {
  const fakeToken = 'fake-token';
  process.env.launchpad_passphrase_secret_name = 'env-secret';
  process.env.launchpad_api = 'https://env-api.example.com';
  process.env.launchpad_certificate = 'env-cert';

  const getLaunchpadTokenStub = sinon.stub(launchpad, 'getLaunchpadToken').resolves(fakeToken);
  const getSecretStringStub = sinon.stub().resolves('passphrase');
  const revert = recreateLaunchpadToken.__set__('getSecretString', getSecretStringStub);

  t.teardown(() => {
    getLaunchpadTokenStub.restore();
    revert();
    delete process.env.launchpad_passphrase_secret_name;
    delete process.env.launchpad_api;
    delete process.env.launchpad_certificate;
  });

  const token = await generateLaunchpadToken({});

  t.is(token, fakeToken);
  t.true(getSecretStringStub.calledWith('env-secret'));
  t.deepEqual(getLaunchpadTokenStub.firstCall.args[0], {
    passphrase: 'passphrase',
    api: 'https://env-api.example.com',
    certificate: 'env-cert',
  });
});

test.serial('lockFileExists returns false when no lock file exists', async (t) => {
  const result = await lockFileExists();
  t.false(result);
});

test.serial('lockFileExists returns true when lock file exists', async (t) => {
  await createLockFile();
  t.teardown(() => removeLockFile());

  const result = await lockFileExists();
  t.true(result);
});

test.serial('createLockFile creates and removeLockFile removes lock file', async (t) => {
  await createLockFile();
  t.true(await lockFileExists());

  await removeLockFile();
  t.false(await lockFileExists());
});

test.serial('putTokenInS3 writes token to S3', async (t) => {
  const tokenKey = `${process.env.system_bucket}/launchpad-token.json`;

  await putTokenInS3('my-token');

  const stored = await S3.getJsonS3Object(process.env.system_bucket, tokenKey);
  t.is(stored.token, 'my-token');
  t.truthy(stored.createdAt);
});

test.serial('handler generates token, stores it in S3, and returns it', async (t) => {
  const fakeToken = 'handler-test-token';
  const getLaunchpadTokenStub = sinon.stub(launchpad, 'getLaunchpadToken').resolves(fakeToken);
  const revert = recreateLaunchpadToken.__set__('getSecretString', sinon.stub().resolves('passphrase'));

  t.teardown(() => {
    getLaunchpadTokenStub.restore();
    revert();
  });

  const result = await handler({ config: { passphraseSecretName: 'secret' } });

  t.is(result.statusCode, 200);
  t.is(result.token, fakeToken);

  const tokenKey = `${process.env.system_bucket}/launchpad-token.json`;
  const stored = await S3.getJsonS3Object(process.env.system_bucket, tokenKey);
  t.is(stored.token, fakeToken);
});

test.serial('handler removes lock file even when token generation fails', async (t) => {
  const getLaunchpadTokenStub = sinon.stub(launchpad, 'getLaunchpadToken').rejects(new Error('generation failed'));
  const revert = recreateLaunchpadToken.__set__('getSecretString', sinon.stub().resolves('passphrase'));

  t.teardown(() => {
    getLaunchpadTokenStub.restore();
    revert();
  });

  await t.throwsAsync(
    () => handler({ config: { passphraseSecretName: 'secret' } }),
    { message: 'generation failed' }
  );

  t.false(await lockFileExists());
});

test.serial('handler creates lock file during execution', async (t) => {
  let lockExistedDuringExecution = false;

  const getLaunchpadTokenStub = sinon.stub(launchpad, 'getLaunchpadToken').callsFake(async () => {
    lockExistedDuringExecution = await lockFileExists();
    return 'token';
  });
  const revert = recreateLaunchpadToken.__set__('getSecretString', sinon.stub().resolves('passphrase'));

  t.teardown(() => {
    getLaunchpadTokenStub.restore();
    revert();
  });

  await handler({ config: { passphraseSecretName: 'secret' } });

  t.true(lockExistedDuringExecution);
  t.false(await lockFileExists());
});
