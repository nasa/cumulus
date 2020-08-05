'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { s3 } = require('../../services');
const S3 = require('../../S3');

test('getObject() returns a NoSuchBucket code if the bucket does not exist', async (t) => {
  const Bucket = cryptoRandomString({ length: 12 });

  const error = await t.throwsAsync(
    S3.getObject(s3(), { Bucket, Key: 'fdsa' })
  );

  t.is(error.code, 'NoSuchBucket');
});

test('getObject() returns a NoSuchKey code if the object does not exist', async (t) => {
  const Bucket = cryptoRandomString({ length: 12 });
  const Key = cryptoRandomString({ length: 12 });

  await S3.createBucket(Bucket);
  t.teardown(() => S3.recursivelyDeleteS3Bucket(Bucket));

  const error = await t.throwsAsync(S3.getObject(s3(), { Bucket, Key }));

  t.is(error.code, 'NoSuchKey');
});
