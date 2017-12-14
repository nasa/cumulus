'use strict';

const aws = require('@cumulus/common/aws');
const testUtils = require('@cumulus/common/test-utils');
const test = require('ava');
const handler = require('../index').handler;
const pify = require('pify');

// Create an S3 bucket for each test
test.beforeEach((t) => {
  t.context.bucket = testUtils.randomString(); // eslint-disable-line no-param-reassign
  return aws.s3().createBucket({ Bucket: t.context.bucket }).promise();
});

// Delete the S3 bucket created in setup
test.afterEach.always(async (t) => {
  const response = await aws.s3().listObjects({ Bucket: t.context.bucket }).promise();
  const keys = response.Contents.map((o) => o.Key);
  await Promise.all(keys.map((key) => aws.deleteS3Object(t.context.bucket, key)));

  try {
    await aws.s3().deleteBucket({ Bucket: t.context.bucket }).promise();
  }
  catch (err) {
    if (err.code !== 'NoSuchBucket') throw err;
  }
});

test('Existing PDR is deleted from S3', async (t) => {
  const key = testUtils.randomString();

  // Setup
  await aws.s3().putObject({ Bucket: t.context.bucket, Key: key, Body: 'my-body' }).promise();

  const event = {
    input: {
      bucket: t.context.bucket,
      key: key
    },
    config: {}
  };

  return pify(handler)(event, {})
    .then(() =>
      aws.s3().getObject({ Bucket: t.context.bucket, Key: key }).promise()
        .then(() => t.fail('S3 object should not exist, but it does.'))
        .catch((e) => t.is(e.code, 'NoSuchKey')))
    .catch((e) => t.fail(e));
});

test('A NoSuchBucket error is returned if the bucket does not exist', (t) => {
  const event = {
    input: {
      bucket: testUtils.randomString(),
      key: testUtils.randomString()
    },
    config: {}
  };

  return pify(handler)(event, {})
    .then(() => t.fail())
    .catch((error) => {
      if (error.code === 'NoSuchBucket') return t.pass();
      return t.fail('Expected bucket to not exist.');
    });
});

test('No error is returned if the object at the key does not exist', (t) => {
  const event = {
    input: {
      bucket: t.context.bucket,
      key: testUtils.randomString()
    },
    config: {}
  };

  return pify(handler)(event, {})
    .then(() => t.pass())
    .catch(() => t.fail('Object deletion failed'));
});
