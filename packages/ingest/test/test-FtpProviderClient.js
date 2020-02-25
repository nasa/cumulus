'use strict';

const sinon = require('sinon');
const proxyquire = require('proxyquire');
const test = require('ava');
const JSFtp = require('jsftp');
const KMS = require('@cumulus/aws-client/KMS');
const S3 = require('@cumulus/aws-client/S3');
const { S3KeyPairProvider } = require('@cumulus/common/key-pair-provider');
const {
  calculateS3ObjectChecksum,
  fileExists,
  recursivelyDeleteS3Bucket,
  headObject
} = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');
const FtpProviderClient = require('../FtpProviderClient');

test.before(async (t) => {
  process.env.system_bucket = randomString();
  process.env.stackName = randomString();

  await S3.createBucket(process.env.system_bucket);

  await S3.putFile(
    process.env.system_bucket,
    `${process.env.stackName}/crypto/ssh_client_rsa_key`,
    require.resolve('@cumulus/test-data/keys/ssh_client_rsa_key')
  );

  await S3.putFile(
    process.env.system_bucket,
    `${process.env.stackName}/crypto/private.pem`,
    require.resolve('@cumulus/test-data/keys/s3_key_pair_provider_private.pem')
  );

  await S3.putFile(
    process.env.system_bucket,
    `${process.env.stackName}/crypto/public.pub`,
    require.resolve('@cumulus/test-data/keys/s3_key_pair_provider_public.pub')
  );

  const createKeyResponse = await KMS.createKey();
  t.context.kmsKeyId = createKeyResponse.KeyMetadata.KeyId;
});

test.after.always(() => S3.recursivelyDeleteS3Bucket(process.env.system_bucket));

test('FtpProviderClient.list lists objects', async (t) => {
  const myFtpProviderClient = new FtpProviderClient({
    host: '127.0.0.1',
    username: 'testuser',
    password: 'testpass',
    useList: true
  });

  const list = await myFtpProviderClient.list('');
  t.true(list.length > 0);
});

test('FtpProviderClient.list filters listed objects with path', async (t) => {
  const myFtpProviderClient = new FtpProviderClient({
    host: '127.0.0.1',
    username: 'testuser',
    password: 'testpass',
    useList: true
  });

  const list = await myFtpProviderClient.list('pdrs/MOD09GQ_1granule_v3.PDR');
  t.true(list.length === 1);
  t.is(list[0].name, 'MOD09GQ_1granule_v3.PDR');
});

test('FtpProviderClient supports plaintext usernames and passwords', async (t) => {
  const ftpClient = new FtpProviderClient({
    host: '127.0.0.1',
    encrypted: false,
    username: 'testuser',
    password: 'testpass',
    useList: true
  });

  const files = await ftpClient.list('/');
  const fileNames = files.map((f) => f.name);

  t.true(fileNames.includes('index.html'));
});

test('FtpProviderClient supports S3-keypair-encrypted usernames and passwords',
  async (t) => {
    const ftpClient = new FtpProviderClient({
      host: '127.0.0.1',
      encrypted: true,
      username: await S3KeyPairProvider.encrypt('testuser'),
      password: await S3KeyPairProvider.encrypt('testpass'),
      useList: true
    });

    const files = await ftpClient.list('/');
    const fileNames = files.map((f) => f.name);

    t.true(fileNames.includes('index.html'));
  });

test('FtpProviderClient supports KMS-encrypted usernames and passwords', async (t) => {
  const ftpClient = new FtpProviderClient({
    host: '127.0.0.1',
    encrypted: true,
    username: await KMS.encrypt(t.context.kmsKeyId, 'testuser'),
    password: await KMS.encrypt(t.context.kmsKeyId, 'testpass'),
    useList: true
  });

  const files = await ftpClient.list('/');
  const fileNames = files.map((f) => f.name);

  t.true(fileNames.includes('index.html'));
});

test('useList is present and true when assigned', async (t) => {
  const jsftpSpy = sinon.spy(JSFtp);
  const ProxiedFtpProviderClient = proxyquire('../FtpProviderClient', {
    jsftp: jsftpSpy
  });

  const myFtpProviderClient = new ProxiedFtpProviderClient({
    host: '127.0.0.1',
    username: 'testuser',
    password: 'testpass',
    useList: true
  });

  await myFtpProviderClient.list('');

  t.true(jsftpSpy.callCount > 0);
  t.is(jsftpSpy.getCall(0).args[0].useList, true);
});

test('useList defaults to false when not assigned', async (t) => {
  const jsftpSpy = sinon.spy(JSFtp);
  const ProxiedFtpProviderClient = proxyquire('../FtpProviderClient', {
    jsftp: jsftpSpy
  });

  const myFtpProviderClient = new ProxiedFtpProviderClient({
    host: '127.0.0.1',
    username: 'testuser',
    password: 'testpass'
  });

  await myFtpProviderClient.list('');

  t.true(jsftpSpy.callCount > 0);
  t.is(jsftpSpy.getCall(0).args[0].useList, false);
});


test('Download remote file to s3 with correct content-type', async (t) => {
  const myFtpProviderClient = new FtpProviderClient({
    host: '127.0.0.1',
    username: 'testuser',
    password: 'testpass',
    path: '',
    useList: true
  });

  const bucket = randomString();
  const key = `${randomString()}.hdf`;
  const expectedContentType = 'application/x-hdf';
  try {
    await s3().createBucket({ Bucket: bucket }).promise();
    await myFtpProviderClient.sync(
      '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf', bucket, key
    );
    t.truthy(fileExists(bucket, key));
    const sum = await calculateS3ObjectChecksum({ algorithm: 'CKSUM', bucket, key });
    t.is(sum, 1435712144);

    const s3HeadResponse = await headObject(bucket, key);
    t.is(expectedContentType, s3HeadResponse.ContentType);
  } finally {
    await recursivelyDeleteS3Bucket(bucket);
  }
});

test.serial('FtpProviderClient throws an error when listing a non-permitted directory', async (t) => {
  const jsftpStubbed = sinon.stub(JSFtp.prototype, 'list').callsFake((path, callback) => callback({
    code: 451,
    text: `Could not retrieve a file listing for ${path}.`,
    isMark: false,
    isError: true
  }));

  const myFtpProviderClient = new FtpProviderClient({
    host: '127.0.0.1',
    username: 'testuser',
    password: 'testpass',
    useList: true
  });
  const error = await t.throwsAsync(myFtpProviderClient.list('/forbidden/file.txt'));
  jsftpStubbed.restore();
  t.true(/^.*451.*forbidden\/file\.txt.*/.test(error.message));
});
