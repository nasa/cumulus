'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const S3 = require('@cumulus/aws-client/S3');
const test = require('ava');
const { promisify } = require('util');
const { randomString } = require('@cumulus/common/test-utils');
const { SftpClient } = require('..');

const readFile = promisify(fs.readFile);
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);

test.before(async (t) => {
  t.context.sftpClient = new SftpClient({
    host: '127.0.0.1',
    port: 2222,
    username: 'user',
    password: 'password',
  });

  await t.context.sftpClient.connect();

  t.context.s3Bucket = randomString();
  await S3.createBucket(t.context.s3Bucket);
});

test.after.always(async (t) => {
  await t.context.sftpClient.end();
  await S3.recursivelyDeleteS3Bucket(t.context.s3Bucket);
});

test('SftpClient supports password authentication', async (t) => {
  const sftpClient = new SftpClient({
    host: '127.0.0.1',
    port: '2222',
    username: 'user',
    password: 'password',
  });

  let files;
  try {
    await sftpClient.connect();

    files = await sftpClient.list('/');
  } finally {
    await sftpClient.end();
  }

  const fileNames = files.map((f) => f.name);

  t.true(fileNames.includes('index.html'));
});

test('SftpClient supports ssh keypair authentication', async (t) => {
  const privateKey = await readFile(
    require.resolve('@cumulus/test-data/keys/ssh_client_rsa_key'),
    'utf8'
  );

  const sftpClient = new SftpClient({
    host: '127.0.0.1',
    port: '2222',
    username: 'user',
    privateKey,
  });

  let files;
  try {
    await sftpClient.connect();
    files = await sftpClient.list('/');
  } finally {
    await sftpClient.end();
  }

  const fileNames = files.map((f) => f.name);

  t.true(fileNames.includes('index.html'));
});

test.serial('sftpClient.list() retrieves a list of files', async (t) => {
  const files = await t.context.sftpClient.list('/');
  t.true(files.length > 0);
});

test.serial('sftpClient.download() saves a remote file to disk', async (t) => {
  const localPath = path.join(os.tmpdir(), randomString());

  try {
    await t.context.sftpClient.download(
      '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf',
      localPath
    );

    const { size } = await stat(localPath);

    t.is(size, 1098034);
  } finally {
    await unlink(localPath);
  }
});

test.serial('sftpClient.download() with fastDownload saves a remote file to disk', async (t) => {
  const localPath = path.join(os.tmpdir(), randomString());

  try {
    await t.context.sftpClient.download(
      '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf',
      localPath,
      true
    );

    const { size } = await stat(localPath);

    t.is(size, 1098034);
  } finally {
    await unlink(localPath);
  }
});

test.serial('sftpClient.syncToS3() transfers a file from SFTP to S3 with the correct content-type', async (t) => {
  const key = `${randomString()}.hdf`;

  await t.context.sftpClient.syncToS3(
    '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf',
    t.context.s3Bucket,
    key
  );

  t.truthy(S3.fileExists(t.context.s3Bucket, key));

  const s3HeadResponse = await S3.headObject(t.context.s3Bucket, key);
  t.is(s3HeadResponse.ContentLength, 1098034);
  t.is(s3HeadResponse.ContentType, 'application/x-hdf');
});

test.serial('sftpClient.syncToS3Fast() transfers a file from SFTP to S3 with the correct content-type', async (t) => {
  process.env.SFTP_DEBUG = 'true';
  const key = `${randomString()}.hdf`;

  await t.context.sftpClient.syncToS3Fast(
    '/granules/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf',
    t.context.s3Bucket,
    key
  );
  const localTmpFile = '/tmp/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf';

  t.false(fs.existsSync(localTmpFile));
  t.truthy(S3.fileExists(t.context.s3Bucket, key));

  const s3HeadResponse = await S3.headObject(t.context.s3Bucket, key);
  t.is(s3HeadResponse.ContentLength, 1098034);
  t.is(s3HeadResponse.ContentType, 'application/x-hdf');
});

test.serial('sftpClient.syncFromS3() transfers a file from S3 to SFTP', async (t) => {
  const Key = randomString();
  const Body = randomString();
  const remotePath = `/granules/${Key}`;

  await S3.s3PutObject({ Bucket: t.context.s3Bucket, Key, Body });

  await t.context.sftpClient.syncFromS3(
    { Bucket: t.context.s3Bucket, Key },
    remotePath
  );

  const remoteFiles = await t.context.sftpClient.list('/granules/');
  const remoteFile = remoteFiles.find((f) => f.name === Key);
  t.not(remoteFile, undefined);
  t.is(remoteFile.size, Body.length);

  await t.context.sftpClient.unlink(remotePath);
});

test.serial('sftpClient.unlink() removes a file from SFTP', async (t) => {
  const Key = randomString();
  const Body = randomString();
  const remotePath = `/granules/${Key}`;

  await S3.s3PutObject({ Bucket: t.context.s3Bucket, Key, Body });

  await t.context.sftpClient.syncFromS3(
    { Bucket: t.context.s3Bucket, Key },
    remotePath
  );

  await t.context.sftpClient.unlink(remotePath);

  const remoteFiles = await t.context.sftpClient.list('/granules/');
  const remoteFile = remoteFiles.find((f) => f.name === Key);
  t.is(remoteFile, undefined);
});
