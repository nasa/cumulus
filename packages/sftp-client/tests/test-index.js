'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('ava');
const KMS = require('@cumulus/aws-client/KMS');
const S3 = require('@cumulus/aws-client/S3');
const { promisify } = require('util');
const { Readable } = require('stream');
const { generateChecksumFromStream } = require('@cumulus/checksum');
const { S3KeyPairProvider } = require('@cumulus/common/key-pair-provider');
const { randomString } = require('@cumulus/common/test-utils');
const SftpClient = require('..');

const readFile = promisify(fs.readFile);

const sftpConfig = {
  host: '127.0.0.1',
  port: '2222',
  username: 'user',
  encrypted: false,
  privateKey: 'ssh_client_rsa_key'
};

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

test('SftpClient supports plaintext usernames and passwords', async (t) => {
  const sftpClient = new SftpClient({
    host: '127.0.0.1',
    port: '2222',
    username: 'user',
    password: 'password',
    encrypted: false
  });

  const files = await sftpClient.list('/');
  const fileNames = files.map((f) => f.name);

  t.true(fileNames.includes('index.html'));
});

test('SftpClient supports S3-keypair-encrypted usernames and passwords', async (t) => {
  const username = await S3KeyPairProvider.encrypt('user');
  const password = await S3KeyPairProvider.encrypt('password');

  const sftpClient = new SftpClient({
    host: '127.0.0.1',
    port: '2222',
    username,
    password,
    encrypted: true
  });

  const files = await sftpClient.list('/');
  const fileNames = files.map((f) => f.name);

  t.true(fileNames.includes('index.html'));
});

test('SftpClient supports KMS-encrypted usernames and passwords', async (t) => {
  const username = await KMS.encrypt(t.context.kmsKeyId, 'user');
  const password = await KMS.encrypt(t.context.kmsKeyId, 'password');

  const sftpClient = new SftpClient({
    host: '127.0.0.1',
    port: '2222',
    username,
    password,
    encrypted: true
  });

  const files = await sftpClient.list('/');
  const fileNames = files.map((f) => f.name);

  t.true(fileNames.includes('index.html'));
});

test('SftpClient supports unencrypted private keys', async (t) => {
  const sftpClient = new SftpClient({
    host: '127.0.0.1',
    port: '2222',
    username: 'user',
    privateKey: 'ssh_client_rsa_key'
  });

  const files = await sftpClient.list('/');
  const fileNames = files.map((f) => f.name);

  t.true(fileNames.includes('index.html'));
});

test('SftpClient supports KMS-encrypted private keys', async (t) => {
  const unencryptedPrivateKey = await readFile(
    require.resolve('@cumulus/test-data/keys/ssh_client_rsa_key'),
    'utf8'
  );

  const privateKeyName = randomString();

  await S3.s3PutObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/crypto/${privateKeyName}`,
    Body: await KMS.encrypt(t.context.kmsKeyId, unencryptedPrivateKey)
  });

  const sftpClient = new SftpClient({
    host: '127.0.0.1',
    port: '2222',
    username: 'user',
    cmKeyId: 'yes',
    privateKey: privateKeyName
  });

  const files = await sftpClient.list('/');
  const fileNames = files.map((f) => f.name);

  t.true(fileNames.includes('index.html'));
});

test('connect and retrieve list of files', async (t) => {
  const testSftpClient = new SftpClient(sftpConfig);
  await testSftpClient.connect();
  const list = await testSftpClient.list('/');
  t.is(list.length > 0, true);
  await testSftpClient.end();
});

test('Download remote file to local disk', async (t) => {
  const testSftpClient = new SftpClient(sftpConfig);

  const localPath = path.join(os.tmpdir(), `delete-me-${randomString()}.txt`);
  await testSftpClient.download(
    '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf', localPath
  );

  const sum = await generateChecksumFromStream('CKSUM', fs.createReadStream(localPath));
  t.is(sum, 1435712144);
  fs.unlinkSync(localPath);
  await testSftpClient.end();
});

test('Transfer remote file to s3 with correct content-type', async (t) => {
  const testSftpClient = new SftpClient(sftpConfig);
  const expectedContentType = 'application/x-hdf';

  const key = `${randomString()}.hdf`;
  await testSftpClient.syncToS3(
    '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf', process.env.system_bucket, key
  );
  t.truthy(S3.fileExists(process.env.system_bucket, key));
  const sum = await S3.calculateS3ObjectChecksum({ algorithm: 'CKSUM', bucket: process.env.system_bucket, key });
  t.is(sum, 1435712144);

  const s3HeadResponse = await S3.headObject(process.env.system_bucket, key);
  t.is(expectedContentType, s3HeadResponse.ContentType);
  await testSftpClient.end();
});

test('Upload file from s3 to remote', async (t) => {
  const s3object = { Bucket: process.env.system_bucket, Key: 'delete-me-test-sftp-uploads3.txt' };
  await S3.s3PutObject({ Body: randomString(), ...s3object });
  const testSftpClient = new SftpClient(sftpConfig);
  await testSftpClient.syncFromS3(s3object, `/granules/${s3object.Key}`);
  const s3sum = await S3.calculateS3ObjectChecksum({ algorithm: 'CKSUM', bucket: process.env.system_bucket, key: s3object.Key });
  const filesum = await generateChecksumFromStream('CKSUM', fs.createReadStream(`../test-data/granules/${s3object.Key}`));
  t.is(s3sum, filesum);
  await testSftpClient.end();
  fs.unlinkSync(`../test-data/granules/${s3object.Key}`);
});

test('Upload data string to remote', async (t) => {
  const testSftpClient = new SftpClient(sftpConfig);
  const data = `${randomString()}${randomString()}`;
  const fileName = 'delete-me-test-sftp-uploaddata.txt';
  await testSftpClient.uploadFromString(data, `/granules/${fileName}`);

  const dataStream = new Readable();
  dataStream.push(data);
  dataStream.push(null);
  const expectedSum = await generateChecksumFromStream('CKSUM', dataStream);
  const filesum = await generateChecksumFromStream('CKSUM', fs.createReadStream(`../test-data/granules/${fileName}`));
  t.is(expectedSum, filesum);
  await testSftpClient.end();
  fs.unlinkSync(`../test-data/granules/${fileName}`);
});
