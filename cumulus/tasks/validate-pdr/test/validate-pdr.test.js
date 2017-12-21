'use strict';

const aws = require('@cumulus/common/aws');
const handler = require('../index').handler;
const pify = require('pify');
const successFixture = require('./fixtures/success-fixture');
const test = require('ava');
const testUtils = require('@cumulus/common/test-utils');

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

test('A PDR is fetched from S3 and validated', async (t) => {
  const key = testUtils.randomString();

  // Push the PDR to S3
  await aws.s3().putObject({
    Bucket: t.context.bucket,
    Key: key,
    Body: successFixture.input
  }).promise();

  const event = {
    input: {
      bucket: t.context.bucket,
      key: key
    },
    config: {}
  };

  await pify(handler)(event, {})
    .then(() => t.pass())
    .catch((e) => t.fail(e));
});
