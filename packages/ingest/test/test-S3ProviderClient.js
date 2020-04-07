'use strict';

const fs = require('fs');
const os = require('os');
const { basename } = require('path');
const test = require('ava');
const S3 = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const S3ProviderClient = require('../S3ProviderClient');

const localPath = './tmp.json';

test.before(async (t) => {
  t.context.sourceBucket = randomString();
  t.context.sourcePrefix = randomString();
  t.context.sourceKey = `${t.context.sourcePrefix}/${randomString()}`;
  t.context.targetBucket = randomString();
  t.context.fileContent = JSON.stringify({ type: 'fake-test-object' });

  await Promise.all([
    S3.createBucket(t.context.sourceBucket),
    S3.createBucket(t.context.targetBucket)
  ]);

  await S3.s3PutObject({
    Bucket: t.context.sourceBucket,
    Key: t.context.sourceKey,
    Body: t.context.fileContent
  });
});

test.after.always(async (t) => {
  fs.unlinkSync(localPath);
  return Promise.all([
    S3.recursivelyDeleteS3Bucket(t.context.sourceBucket),
    S3.recursivelyDeleteS3Bucket(t.context.targetBucket)
  ]);
})

test('S3ProviderClient constructor throws error if no bucket specified', (t) => {
  t.throws(
    () => new S3ProviderClient(),
    'bucket is required'
  );
  t.throws(
    () => new S3ProviderClient({}),
    'bucket is required'
  );
});

test.serial('S3ProviderClient.list lists objects under a path in a bucket', async (t) => {
  const s3ProviderClient = new S3ProviderClient({ bucket: t.context.sourceBucket });

  const files = await s3ProviderClient.list(t.context.sourcePrefix);
  t.is(files.length, 1);
  t.is(files[0].name, basename(t.context.sourceKey));
});

test.serial('S3ProviderClient.downloads downloads a file to local disk', async (t) => {
  const s3ProviderClient = new S3ProviderClient({ bucket: t.context.sourceBucket });

  await s3ProviderClient.download(t.context.sourceKey, localPath);
  t.true(fs.existsSync(localPath));
});

test.serial('S3ProviderClient.sync syncs a file to a target S3 location', async (t) => {
  const s3ProviderClient = new S3ProviderClient({ bucket: t.context.sourceBucket });
  const targetKey = 'target.json'

  await s3ProviderClient.sync(t.context.sourceKey, t.context.targetBucket, targetKey);
  t.true(await S3.s3ObjectExists({ Bucket: t.context.targetBucket, Key: targetKey }));
});

test.serial('S3ProviderClient.sync throws an error if the source file does not exist', async (t) => {
  const s3ProviderClient = new S3ProviderClient({ bucket: t.context.sourceBucket });

  await t.throwsAsync(
    () => s3ProviderClient.sync('non-existent', t.context.targetBucket, 'target.json'),
    `Source file not found s3://${t.context.sourceBucket}/non-existent`
  );
});
