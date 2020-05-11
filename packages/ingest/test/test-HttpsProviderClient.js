'use strict';

const test = require('ava');
const fs = require('fs');
const path = require('path');
const createTestServer = require('create-test-server');
const { tmpdir } = require('os');
const {
  fileExists,
  getTextObject,
  headObject,
  promiseS3Upload,
  recursivelyDeleteS3Bucket
} = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');
const HttpProviderClient = require('../HttpProviderClient');

test.before(async (t) => {
  t.context.server = await createTestServer({ certificate: '127.0.0.1' });

  t.context.configBucket = randomString();
  await s3().createBucket({ Bucket: t.context.configBucket }).promise();
  await promiseS3Upload({
    Bucket: t.context.configBucket,
    Key: 'certificate.pem',
    Body: t.context.server.caCert
  });

  t.context.httpsProviderClient = new HttpProviderClient({
    protocol: 'https',
    host: '127.0.0.1',
    port: t.context.server.sslPort,
    certificateUri: `s3://${t.context.configBucket}/certificate.pem`
  });
});

test.after.always(async (t) => {
  await t.context.server.close();
  await recursivelyDeleteS3Bucket(t.context.configBucket);
});

test('list() with HTTPS returns expected files', async (t) => {
  t.context.server.get('/', '<html><body><A HREF="test.txt">test.txt</A></body></html>');

  const expectedFiles = [{ name: 'test.txt', path: '' }];

  const actualFiles = await t.context.httpsProviderClient.list('');

  t.deepEqual(actualFiles, expectedFiles);
});

test('download() downloads a file', async (t) => {
  const remotePath = 'files/download-me.txt';
  t.context.server.get(`/${remotePath}`, '<FILE CONTENTS>');

  const { httpsProviderClient } = t.context;
  const localPath = path.join(tmpdir(), randomString());
  try {
    await httpsProviderClient.download(remotePath, localPath);
    t.is(fs.existsSync(localPath), true);
  } finally {
    fs.unlinkSync(localPath);
  }
});

test('sync() downloads remote file to s3 with correct content-type', async (t) => {
  const bucket = randomString();
  const key = 'syncedFile.json';
  const remotePath = 'test/file.hdf';
  const remoteContent = '<HDF CONTENT>';
  const expectedContentType = 'application/x-hdf';
  t.context.server.get(`/${remotePath}`, (_, res) => {
    res.header({ 'content-type': expectedContentType });
    res.end(remoteContent);
  });
  try {
    await s3().createBucket({ Bucket: bucket }).promise();
    await t.context.httpsProviderClient.sync(
      remotePath, bucket, key
    );
    t.truthy(fileExists(bucket, key));
    const syncedContent = await getTextObject(bucket, key);
    t.is(syncedContent, remoteContent);

    const s3HeadResponse = await headObject(bucket, key);
    t.is(expectedContentType, s3HeadResponse.ContentType);
  } finally {
    await recursivelyDeleteS3Bucket(bucket);
  }
});
