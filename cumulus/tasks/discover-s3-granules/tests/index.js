/* eslint-disable no-param-reassign, require-jsdoc */
'use strict';

const test = require('ava');
const aws = require('@cumulus/common/aws');
const testUtils = require('@cumulus/common/test-utils');
const input = require('./fixtures/input.json');
const { discoverS3 } = require('../index');

async function deleteBucket(bucket) {
  const response = await aws.s3().listObjects({ Bucket: bucket }).promise();
  const keys = response.Contents.map((o) => o.Key);
  await Promise.all(keys.map((key) =>
    aws.s3().deleteObject({ Bucket: bucket, Key: key }).promise()
  ));
}

function putObject(bucket, key) {
  return aws.s3().putObject({ Bucket: bucket, Key: key, Body: 'test' }).promise();
}

test.beforeEach((t) => {
  t.context.bucket = testUtils.randomString();
  return aws.s3().createBucket({ Bucket: t.context.bucket }).promise();
});

test.afterEach.always(async (t) => {
  await deleteBucket(t.context.bucket);
});

test('empty bucket results in empty granules array', async (t) => {
  const newPayload = Object.assign({}, input);
  newPayload.config.bucket = t.context.bucket;

  const output = await discoverS3(newPayload);
  t.true(output && typeof output === 'object');
  t.true(output.granules && Array.isArray(output.granules));
  t.true(output.granules.length === 0);
});

test('filter using file_type', async (t) => {
  const newPayload = Object.assign({}, input);
  newPayload.config.bucket = t.context.bucket;
  newPayload.config.granuleIdExtraction = '^(GW1AM2_(.*))\\.h5$';
  newPayload.config.file_type = '.h5';

  const keys = [
    `GW1AM2_${testUtils.randomString()}.h5`,
    `GW1AM2_${testUtils.randomString()}.txt`
  ];

  await Promise.all(keys.map((key) =>
    putObject(t.context.bucket, key)
  ));
  const output = await discoverS3(newPayload);
  t.true(output && typeof output === 'object');
  t.true(output.granules && Array.isArray(output.granules));
  t.true(output.granules.length === 1);
});

test('use file_prefix', async (t) => {
  const newPayload = Object.assign({}, input);
  newPayload.config.bucket = t.context.bucket;
  newPayload.config.granuleIdExtraction = '^(GW1AM2_(.*))\\.h5$';
  newPayload.config.file_type = null;
  newPayload.config.file_prefix = 'GW1AM2_';

  const keys = [
    `GW1AM2_${testUtils.randomString()}.h5`,
    `${testUtils.randomString()}.h5`
  ];

  await Promise.all(keys.map((key) =>
    putObject(t.context.bucket, key)
  ));

  const output = await discoverS3(newPayload);
  t.true(output && typeof output === 'object');
  t.true(output.granules && Array.isArray(output.granules));
  t.true(output.granules.length === 1);
});

test('file_type and file_prefix', async (t) => {
  const newPayload = Object.assign({}, input);
  newPayload.config.bucket = t.context.bucket;
  newPayload.config.granuleIdExtraction = '^(GW1AM2_(.*))\\.h5$';

  const keys = [
    `GW1AM2_${testUtils.randomString()}.h5`,
    `GW1AM2_${testUtils.randomString()}.txt`,
    `${testUtils.randomString()}.h5`
  ];

  await Promise.all(keys.map((key) =>
    putObject(t.context.bucket, key)
  ));
  const output = await discoverS3(newPayload);
  t.true(output && typeof output === 'object');
  t.true(output.granules && Array.isArray(output.granules));
  t.true(output.granules.length === 1);
});
