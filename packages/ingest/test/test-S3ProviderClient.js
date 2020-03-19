'use strict';

const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const test = require('ava');

const {
  createBucket,
  s3PutObject,
  recursivelyDeleteS3Bucket
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const S3ProviderClient = require('../S3ProviderClient');

test.before(async (t) => {
  t.context.bucket = randomString();
  await createBucket(t.context.bucket);

  t.context.s3ProviderClient = new S3ProviderClient({ bucket: t.context.bucket });
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.bucket);
});

test('download() can handle a remote path that starts with a slash', async (t) => {
  const { bucket, s3ProviderClient } = t.context;
  const key = randomString();

  await s3PutObject({ Bucket: bucket, Key: key, Body: 'asdf' });

  const localPath = path.join(os.tmpdir(), randomString());
  try {
    await s3ProviderClient.download(`/${key}`, localPath);
    t.is(await fs.readFile(localPath, 'utf8'), 'asdf');
  } finally {
    await fs.remove(localPath);
  }
});

test('download() can handle a remote path that starts with multiple slashes', async (t) => {
  const { bucket, s3ProviderClient } = t.context;
  const key = randomString();

  await s3PutObject({ Bucket: bucket, Key: key, Body: 'asdf' });

  const localPath = path.join(os.tmpdir(), randomString());
  try {
    await s3ProviderClient.download(`///${key}`, localPath);
    t.is(await fs.readFile(localPath, 'utf8'), 'asdf');
  } finally {
    await fs.remove(localPath);
  }
});

test('list() can handle a path that starts with a slash', async (t) => {
  const { bucket, s3ProviderClient } = t.context;

  const path1 = randomString();
  const path2 = randomString();

  await s3PutObject({ Bucket: bucket, Key: `${path1}/${path2}`, Body: 'asdf' });

  const listResponse = await s3ProviderClient.list(`/${path1}`);

  t.is(listResponse.length, 1);
  t.is(listResponse[0].path, path1);
  t.is(listResponse[0].name, path2);
});

test('list() can handle a path that starts with multiple slashes', async (t) => {
  const { bucket, s3ProviderClient } = t.context;

  const path1 = randomString();
  const path2 = randomString();

  await s3PutObject({ Bucket: bucket, Key: `${path1}/${path2}`, Body: 'asdf' });

  const listResponse = await s3ProviderClient.list(`///${path1}`);

  t.is(listResponse.length, 1);
  t.is(listResponse[0].path, path1);
  t.is(listResponse[0].name, path2);
});
