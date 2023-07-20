'use strict';

const path = require('path');
const { tmpdir } = require('os');
const fs = require('fs');
const test = require('ava');

const { randomString } = require('@cumulus/common/test-utils');
const errors = require('@cumulus/errors');
const S3 = require('@cumulus/aws-client/S3');

const S3ProviderClient = require('../S3ProviderClient');

test.before(async (t) => {
  t.context.sourceBucket = randomString();
  t.context.sourcePrefix = randomString();
  t.context.sourceKey = `${t.context.sourcePrefix}/${randomString()}`;
  t.context.targetBucket = randomString();
  t.context.fileContent = JSON.stringify({ type: 'fake-test-object' });

  await Promise.all([
    S3.createBucket(t.context.sourceBucket),
    S3.createBucket(t.context.targetBucket),
  ]);

  await S3.s3PutObject({
    Bucket: t.context.sourceBucket,
    Key: t.context.sourceKey,
    Body: t.context.fileContent,
  });
});

test.after.always(async (t) => await Promise.all([
  S3.recursivelyDeleteS3Bucket(t.context.sourceBucket),
  S3.recursivelyDeleteS3Bucket(t.context.targetBucket),
]));

test('S3ProviderClient constructor throws error if no bucket specified', (t) => {
  t.throws(
    () => new S3ProviderClient(),
    { message: 'bucket is required' }
  );
  t.throws(
    () => new S3ProviderClient({}),
    { message: 'bucket is required' }
  );
});

test.serial('S3ProviderClient.list lists objects from the bucket root with paths', async (t) => {
  const s3ProviderClient = new S3ProviderClient({ bucket: t.context.sourceBucket });

  const files = await s3ProviderClient.list('');
  t.is(files.length, 1);
  t.is(files[0].name, path.basename(t.context.sourceKey));
  t.is(files[0].path, path.dirname(t.context.sourceKey));
});

test.serial('S3ProviderClient.list lists objects under a path in a bucket', async (t) => {
  const s3ProviderClient = new S3ProviderClient({ bucket: t.context.sourceBucket });

  const files = await s3ProviderClient.list(t.context.sourcePrefix);
  t.is(files.length, 1);
  t.is(files[0].name, path.basename(t.context.sourceKey));
});

test.serial('S3ProviderClient.download downloads a file to local disk', async (t) => {
  const s3ProviderClient = new S3ProviderClient({ bucket: t.context.sourceBucket });

  const localPath = './tmp.json';
  t.teardown(() => fs.unlinkSync(localPath));

  await s3ProviderClient.download({ remotePath: t.context.sourceKey, localPath });
  t.true(fs.existsSync(localPath));
  t.is(fs.readFileSync(localPath).toString(), t.context.fileContent);
});

test.serial('S3ProviderClient.download downloads a file to local disk when source_bucket is set', async (t) => {
  const s3ProviderClient = new S3ProviderClient({ bucket: 'fake_bucket' });

  const localPath = './tmp.json';
  t.teardown(() => fs.unlinkSync(localPath));

  await s3ProviderClient.download({
    remotePath: t.context.sourceKey,
    localPath,
    remoteAltBucket: t.context.sourceBucket,
  });
  t.true(fs.existsSync(localPath));
  t.is(fs.readFileSync(localPath).toString(), t.context.fileContent);
});

test.serial('S3ProviderClient.sync syncs a file with a bucket parameter defined from the expected bucket', async (t) => {
  const s3ProviderClient = new S3ProviderClient({ bucket: 'fooBarFakeBucket' });
  const targetKey = 'target.json';

  const { s3uri, etag } = await s3ProviderClient.sync({
    bucket: t.context.sourceBucket,
    destinationBucket: t.context.targetBucket,
    destinationKey: targetKey,
    fileRemotePath: t.context.sourceKey,
  });
  t.truthy(s3uri, 'Missing s3uri');
  t.truthy(etag, 'Missing etag');
  t.is(
    await S3.getTextObject(t.context.targetBucket, targetKey),
    t.context.fileContent
  );
});

test.serial('S3ProviderClient.sync syncs a file to a target S3 location', async (t) => {
  const s3ProviderClient = new S3ProviderClient({ bucket: t.context.sourceBucket });
  const targetKey = 'target.json';

  const { s3uri, etag } = await s3ProviderClient.sync({
    destinationBucket: t.context.targetBucket,
    destinationKey: targetKey,
    fileRemotePath: t.context.sourceKey,
  });
  t.truthy(s3uri, 'Missing s3uri');
  t.truthy(etag, 'Missing etag');
  t.is(
    await S3.getTextObject(t.context.targetBucket, targetKey),
    t.context.fileContent
  );
});

test.serial('S3ProviderClient.sync syncs a 0 byte file', async (t) => {
  // This test doesn't really prove anything since Localstack does not behave exactly like S3.
  // However, if Localstack fixes multipart upload handling to match real S3 behavior, this will
  // be a useful test.
  const s3ProviderClient = new S3ProviderClient({ bucket: t.context.sourceBucket });
  const targetKey = '0byte.dat';

  await S3.s3PutObject({
    Bucket: t.context.sourceBucket,
    Key: t.context.sourceKey,
    // ensure file has 0 bytes
    Body: '',
  });

  const { s3uri, etag } = await s3ProviderClient.sync({
    destinationBucket: t.context.targetBucket,
    destinationKey: targetKey,
    fileRemotePath: t.context.sourceKey,
  });
  t.truthy(s3uri, 'Missing s3uri');
  t.truthy(etag, 'Missing etag');
});

test.serial('S3ProviderClient.sync throws an error if the source file does not exist', async (t) => {
  const s3ProviderClient = new S3ProviderClient({ bucket: t.context.sourceBucket });

  await t.throwsAsync(
    s3ProviderClient.sync({
      destinationBucket: t.context.targetBucket,
      destinationKey: 'target.json',
      fileRemotePath: 'non-existent',
    }),
    {
      instanceOf: errors.FileNotFound,
      message: `Source file not found s3://${t.context.sourceBucket}/non-existent`,
    }
  );
});

test.serial('S3ProviderClient.upload uploads a file', async (t) => {
  const s3ProviderClient = new S3ProviderClient({ bucket: t.context.sourceBucket });
  const localPath = path.join(tmpdir(), randomString());
  t.teardown(() => fs.unlinkSync(localPath));
  const uploadPath = `${randomString()}/destinationfile.txt`;

  fs.writeFileSync(localPath, t.context.fileContent);
  await s3ProviderClient.upload({ localPath, uploadPath });

  t.is(
    await S3.getTextObject(t.context.sourceBucket, uploadPath),
    t.context.fileContent
  );
});
