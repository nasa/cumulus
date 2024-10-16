'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('ava');
const { s3 } = require('@cumulus/aws-client/services');
const KMS = require('@cumulus/aws-client/KMS');
const S3 = require('@cumulus/aws-client/S3');
const { promisify } = require('util');
const { generateChecksumFromStream } = require('@cumulus/checksum');
const { S3KeyPairProvider } = require('@cumulus/common/key-pair-provider');
const { randomString } = require('@cumulus/common/test-utils');
const SftpProviderClient = require('../SftpProviderClient');

const readFile = promisify(fs.readFile);

test.before(async (t) => {
  process.env.stackName = randomString();

  process.env.system_bucket = randomString();
  await S3.createBucket(process.env.system_bucket);

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

  await S3.putFile(
    process.env.system_bucket,
    `${process.env.stackName}/crypto/ssh_client_rsa_key`,
    require.resolve('@cumulus/test-data/keys/ssh_client_rsa_key')
  );

  const createKeyResponse = await KMS.createKey();
  t.context.kmsKeyId = createKeyResponse.KeyMetadata.KeyId;
});

test.beforeEach(async (t) => {
  t.context.mySftpProviderClient = new SftpProviderClient({
    host: '127.0.0.1',
    port: 2222,
    username: 'user',
    encrypted: false,
    privateKey: 'ssh_client_rsa_key',
  });

  await t.context.mySftpProviderClient.connect();
});

test.afterEach.always(async (t) => {
  await t.context.mySftpProviderClient.end();
});

test.after.always(async () => {
  await Promise.all([
    S3.recursivelyDeleteS3Bucket(process.env.system_bucket),
  ]);
});

test('SftpProviderClient supports plaintext usernames and passwords', async (t) => {
  const sftpProviderClient = new SftpProviderClient({
    host: '127.0.0.1',
    port: 2222,
    username: 'user',
    password: 'password',
    encrypted: false,
  });

  await sftpProviderClient.connect();
  t.teardown(() => sftpProviderClient.end());

  const files = await sftpProviderClient.list('/');

  t.true(files.map((f) => f.name).includes('index.html'));
});

test('SftpProviderClient supports S3-keypair-encrypted usernames and passwords', async (t) => {
  const sftpProviderClient = new SftpProviderClient({
    host: '127.0.0.1',
    port: 2222,
    username: await S3KeyPairProvider.encrypt('user'),
    password: await S3KeyPairProvider.encrypt('password'),
    encrypted: true,
  });

  await sftpProviderClient.connect();
  t.teardown(() => sftpProviderClient.end());

  const files = await sftpProviderClient.list('/');

  t.true(files.map((f) => f.name).includes('index.html'));
});

test('SftpClient supports KMS-encrypted usernames and passwords', async (t) => {
  const sftpProviderClient = new SftpProviderClient({
    host: '127.0.0.1',
    port: 2222,
    username: await KMS.encrypt(t.context.kmsKeyId, 'user'),
    password: await KMS.encrypt(t.context.kmsKeyId, 'password'),
    encrypted: true,
  });

  await sftpProviderClient.connect();
  t.teardown(() => sftpProviderClient.end());

  const files = await sftpProviderClient.list('/');

  t.true(files.map((f) => f.name).includes('index.html'));
});

test('SftpClient supports unencrypted private keys', async (t) => {
  const sftpProviderClient = new SftpProviderClient({
    host: '127.0.0.1',
    port: 2222,
    username: 'user',
    privateKey: 'ssh_client_rsa_key',
  });

  await sftpProviderClient.connect();
  t.teardown(() => sftpProviderClient.end());

  const files = await sftpProviderClient.list('/');

  t.true(files.map((f) => f.name).includes('index.html'));
});

test('SftpClient supports KMS-encrypted private keys', async (t) => {
  const unencryptedPrivateKey = await readFile(
    require.resolve('@cumulus/test-data/keys/ssh_client_rsa_key'),
    'utf8'
  );

  const privateKey = randomString();

  await S3.s3PutObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/crypto/${privateKey}`,
    Body: await KMS.encrypt(t.context.kmsKeyId, unencryptedPrivateKey),
  });

  const sftpProviderClient = new SftpProviderClient({
    host: '127.0.0.1',
    port: 2222,
    username: 'user',
    cmKeyId: 'sureWhyNot',
    privateKey,
  });

  await sftpProviderClient.connect();
  t.teardown(() => sftpProviderClient.end());

  const files = await sftpProviderClient.list('/');

  t.true(files.map((f) => f.name).includes('index.html'));
});

test('SftpProviderClient.list lists objects', async (t) => {
  const { mySftpProviderClient } = t.context;

  const list = await mySftpProviderClient.list('');
  t.true(list.length > 0);
});

test('SftpProviderClient.list filters listed objects with path', async (t) => {
  const { mySftpProviderClient } = t.context;

  const list = await mySftpProviderClient.list('pdrs/MOD09GQ_1granule_v3.PDR');
  t.true(list.length === 1);
  t.is(list[0].name, 'MOD09GQ_1granule_v3.PDR');
});

test.serial('Download remote file to s3 with correct content-type', async (t) => {
  const { mySftpProviderClient } = t.context;

  const expectedContentType = 'application/x-hdf';

  const key = `${randomString()}.hdf`;
  const { s3uri, etag } = await mySftpProviderClient.sync({
    fileRemotePath: '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf',
    destinationBucket: process.env.system_bucket,
    destinationKey: key,
  });
  t.truthy(s3uri, 'Missing s3uri');
  t.truthy(etag, 'Missing etag');
  t.truthy(S3.fileExists(process.env.system_bucket, key));
  const sum = await S3.calculateObjectHash({
    s3: s3(),
    algorithm: 'CKSUM',
    bucket: process.env.system_bucket,
    key,
  });
  t.is(sum, '1435712144');

  const s3HeadResponse = await S3.headObject(process.env.system_bucket, key);
  t.is(expectedContentType, s3HeadResponse.ContentType);
});

test.serial('Fast download remote file to s3 with correct content-type', async (t) => {
  const { mySftpProviderClient } = t.context;

  const expectedContentType = 'application/x-hdf';

  const key = `${randomString()}.hdf`;
  const { s3uri, etag } = await mySftpProviderClient.sync({
    fileRemotePath: '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf',
    destinationBucket: process.env.system_bucket,
    destinationKey: key,
    fastDownload: true,
  });
  t.truthy(s3uri, 'Missing s3uri');
  t.truthy(etag, 'Missing etag');
  t.truthy(S3.fileExists(process.env.system_bucket, key));
  const sum = await S3.calculateObjectHash({
    s3: s3(),
    algorithm: 'CKSUM',
    bucket: process.env.system_bucket,
    key,
  });
  t.is(sum, '1435712144');

  const s3HeadResponse = await S3.headObject(process.env.system_bucket, key);
  t.is(expectedContentType, s3HeadResponse.ContentType);
});

test.serial('Download remote file to local disk', async (t) => {
  const { mySftpProviderClient } = t.context;

  const localPath = path.join(os.tmpdir(), `delete-me-${randomString()}.txt`);
  await mySftpProviderClient.download({
    remotePath: '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf', localPath,
  });

  const sum = await generateChecksumFromStream('CKSUM', fs.createReadStream(localPath));
  t.is(sum, '1435712144');
  fs.unlinkSync(localPath);
});

test.serial('Fast download remote file to local disk', async (t) => {
  const { mySftpProviderClient } = t.context;

  const localPath = path.join(os.tmpdir(), `delete-me-${randomString()}.txt`);
  await mySftpProviderClient.download({
    remotePath: '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf', localPath, fastDownload: true,
  });

  const sum = await generateChecksumFromStream('CKSUM', fs.createReadStream(localPath));
  t.is(sum, '1435712144');
  fs.unlinkSync(localPath);
});
