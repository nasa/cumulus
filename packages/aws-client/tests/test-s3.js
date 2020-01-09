'use strict';

const fs = require('fs');
const path = require('path');
const { tmpdir } = require('os');
const test = require('ava');

const { UnparsableFileLocationError } = require('@cumulus/common/errors');
const { randomString } = require('@cumulus/common/test-utils');

const {
  downloadS3File,
  listS3ObjectsV2,
  recursivelyDeleteS3Bucket,
  s3Join,
  calculateS3ObjectChecksum,
  validateS3ObjectChecksum,
  getFileBucketAndKey
} = require('../s3');
const awsServices = require('../services');

test('s3Join behaves as expected', (t) => {
  // Handles an array argument
  t.is(s3Join(['a', 'b', 'c']), 'a/b/c');

  t.is(s3Join(['a', 'b']), 'a/b');
  t.is(s3Join(['a', 'b/']), 'a/b/');
  t.is(s3Join(['a/', 'b']), 'a/b');
  t.is(s3Join(['/a', 'b']), 'a/b');
  t.is(s3Join(['a/', 'b']), 'a/b');

  t.is(s3Join(['a']), 'a');
  t.is(s3Join(['/a']), 'a');
  t.is(s3Join(['a/']), 'a/');

  // Handles a list of arguments
  t.is(s3Join('a', 'b'), 'a/b');
});

test('listS3ObjectsV2 handles non-truncated case', async (t) => {
  const Bucket = randomString();
  await awsServices.s3().createBucket({ Bucket }).promise();

  await Promise.all(['a', 'b', 'c'].map((Key) => awsServices.s3().putObject({
    Bucket,
    Key,
    Body: 'my-body'
  }).promise()));

  // List things from S3
  const result = await listS3ObjectsV2({ Bucket, MaxKeys: 5 });
  const actualKeys = new Set(result.map((object) => object.Key));
  const expectedKeys = new Set(['a', 'b', 'c']);

  t.deepEqual(actualKeys, expectedKeys);

  return recursivelyDeleteS3Bucket(Bucket);
});

test('listS3ObjectsV2 handles truncated case', async (t) => {
  const Bucket = randomString();
  await awsServices.s3().createBucket({ Bucket }).promise();

  await Promise.all(['a', 'b', 'c'].map((Key) => awsServices.s3().putObject({
    Bucket,
    Key,
    Body: 'my-body'
  }).promise()));

  // List things from S3
  const result = await listS3ObjectsV2({ Bucket, MaxKeys: 2 });
  const actualKeys = new Set(result.map((object) => object.Key));
  const expectedKeys = new Set(['a', 'b', 'c']);

  t.deepEqual(actualKeys, expectedKeys);

  return recursivelyDeleteS3Bucket(Bucket);
});

test('downloadS3File rejects promise if key not found', async (t) => {
  const Bucket = randomString();
  await awsServices.s3().createBucket({ Bucket }).promise();

  try {
    await downloadS3File({ Bucket, Key: 'not-gonna-find-it' }, '/tmp/wut');
  } catch (err) {
    t.is(err.message, 'The specified key does not exist.');
  }
});

test('downloadS3File resolves filepath if key is found', async (t) => {
  const Bucket = randomString();
  const Key = 'example';
  const Body = 'example';

  await awsServices.s3().createBucket({ Bucket }).promise();
  await awsServices.s3().putObject({ Bucket, Key: Key, Body: Body }).promise();

  const params = { Bucket, Key: Key };
  const filepath = await downloadS3File(params, path.join(tmpdir(), 'example'));

  const result = await new Promise((resolve, reject) => {
    fs.readFile(filepath, 'utf-8', (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

  t.is(result, Body);
});

test('calculateS3ObjectChecksum returns correct checksum', async (t) => {
  const Bucket = randomString();
  const Key = 'example';
  const Body = 'example';
  const cksum = 148323542;
  const md5sum = '1a79a4d60de6718e8e5b326e338ae533';
  const shasum = 'c3499c2729730a7f807efb8676a92dcb6f8a3f8f';
  const sha256sum = '50d858e0985ecc7f60418aaf0cc5ab587f42c2570a884095a9e8ccacd0f6545c';

  await awsServices.s3().createBucket({ Bucket }).promise();
  await awsServices.s3().putObject({ Bucket, Key, Body }).promise();

  const ck = await calculateS3ObjectChecksum({ algorithm: 'cksum', bucket: Bucket, key: Key });
  const md5 = await calculateS3ObjectChecksum({ algorithm: 'md5', bucket: Bucket, key: Key });
  const sha1 = await calculateS3ObjectChecksum({ algorithm: 'sha1', bucket: Bucket, key: Key });
  const sha256 = await calculateS3ObjectChecksum({ algorithm: 'sha256', bucket: Bucket, key: Key });
  t.is(ck, cksum);
  t.is(md5, md5sum);
  t.is(sha1, shasum);
  t.is(sha256, sha256sum);
  return recursivelyDeleteS3Bucket(Bucket);
});

test('validateS3ObjectChecksum returns true for good checksum', async (t) => {
  const Bucket = randomString();
  const Key = 'example';
  const Body = 'example';

  await awsServices.s3().createBucket({ Bucket }).promise();
  await awsServices.s3().putObject({ Bucket, Key, Body }).promise();

  const cksum = 148323542;
  const ret = await validateS3ObjectChecksum({
    algorithm: 'cksum', bucket: Bucket, key: Key, expectedSum: cksum
  });
  t.true(ret);
  return recursivelyDeleteS3Bucket(Bucket);
});

test('validateS3ObjectChecksum throws InvalidChecksum error on bad checksum', async (t) => {
  const Bucket = randomString();
  const Key = 'example';
  const Body = 'example';

  await awsServices.s3().createBucket({ Bucket }).promise();
  await awsServices.s3().putObject({ Bucket, Key, Body }).promise();

  const cksum = 11111111111;

  await t.throwsAsync(
    () => validateS3ObjectChecksum({
      algorithm: 'cksum', bucket: Bucket, key: Key, expectedSum: cksum
    }),
    `Invalid checksum for S3 object s3://${Bucket}/${Key} with type cksum and expected sum ${cksum}`
  );

  return recursivelyDeleteS3Bucket(Bucket);
});

test('getFileBucketAndKey parses bucket and key', (t) => {
  const pathParams = 'test-bucket/path/key.txt';

  const [bucket, key] = getFileBucketAndKey(pathParams);

  t.is(bucket, 'test-bucket');
  t.is(key, 'path/key.txt');
});

test('getFileBucketAndKey throws UnparsableFileLocationError if location cannot be parsed', (t) => {
  const pathParams = 'test-bucket';

  t.throws(
    () => getFileBucketAndKey(pathParams),
    UnparsableFileLocationError
  );
});
