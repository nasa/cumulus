'use strict';

const fs = require('fs');
const test = require('ava');
const sinon = require('sinon');
const aws = require('@cumulus/common/aws');
const testUtils = require('@cumulus/common/test-utils');

const cmrjs = require('@cumulus/cmrjs');
const payload = require('./data/payload.json');
const { postToCMR } = require('../index');

// eslint-disable-next-line require-jsdoc
async function deleteBucket(bucket) {
  const response = await aws.s3().listObjects({ Bucket: bucket }).promise();
  const keys = response.Contents.map((o) => o.Key);
  await Promise.all(keys.map(
    (key) => aws.s3().deleteObject({ Bucket: bucket, Key: key }).promise()
  ));
}

test.beforeEach((t) => {
  t.context.bucket = testUtils.randomString(); // eslint-disable-line no-param-reassign
  return aws.s3().createBucket({ Bucket: t.context.bucket }).promise();
});

test.afterEach.always(async (t) => {
  deleteBucket(t.context.bucket);
});

