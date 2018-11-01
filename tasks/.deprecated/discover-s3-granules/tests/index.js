'use strict';

const fs = require('fs');
const path = require('path');
const test = require('ava');
const aws = require('@cumulus/common/aws');
const testUtils = require('@cumulus/common/test-utils');
const { promisify } = require('util');
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

test.beforeEach(async (t) => {
  t.context.bucket = testUtils.randomString();
  await aws.s3().createBucket({ Bucket: t.context.bucket }).promise();

  const payloadPath = path.join(__dirname, 'fixtures', 'input.json');
  const rawPayload = await readFile(payloadPath, 'utf8');
  t.context.payload = JSON.parse(rawPayload);
});

test.afterEach.always(async (t) => {
  await deleteBucket(t.context.bucket);
});

test.serial('empty bucket results in empty granules array', async (t) => {
  const { payload } = t.context;
  payload.config.bucket = t.context.bucket;

  const output = await discoverS3(payload);
  t.true(output && typeof output === 'object');
  t.true(output.granules && Array.isArray(output.granules));
  t.true(output.granules.length === 0);
});

test.serial('filter using file_type', async (t) => {
  const { payload } = t.context;
  payload.config.bucket = t.context.bucket;
  payload.config.granuleIdExtraction = '^(GW1AM2_(.*))\\.h5$';
  payload.config.file_type = '.h5';

  const keys = [
    `GW1AM2_${testUtils.randomString()}.h5`,
    `GW1AM2_${testUtils.randomString()}.txt`
  ];

  await Promise.all(keys.map((key) =>
    putObject(t.context.bucket, key)
  ));
  const output = await discoverS3(payload);
  t.true(output && typeof output === 'object');
  t.true(output.granules && Array.isArray(output.granules));
  t.true(output.granules.length === 1);
});

test.serial('use file_prefix', async (t) => {
  const { payload } = t.context;
  payload.config.bucket = t.context.bucket;
  payload.config.granuleIdExtraction = '^(GW1AM2_(.*))\\.h5$';
  payload.config.file_type = null;
  payload.config.file_prefix = 'GW1AM2_';

  const keys = [
    `GW1AM2_${testUtils.randomString()}.h5`,
    `${testUtils.randomString()}.h5`
  ];

  await Promise.all(keys.map((key) =>
    putObject(t.context.bucket, key)
  ));

  const output = await discoverS3(payload);
  t.true(output && typeof output === 'object');
  t.true(output.granules && Array.isArray(output.granules));
  t.true(output.granules.length === 1);
});

test.serial('file_type and file_prefix', async (t) => {
  const { payload } = t.context;
  payload.config.bucket = t.context.bucket;
  payload.config.granuleIdExtraction = '^(GW1AM2_(.*))\\.h5$';

  const keys = [
    `GW1AM2_${testUtils.randomString()}.h5`,
    `GW1AM2_${testUtils.randomString()}.txt`,
    `${testUtils.randomString()}.h5`
  ];

  await Promise.all(keys.map((key) =>
    putObject(t.context.bucket, key)
  ));
  const output = await discoverS3(payload);
  t.true(output && typeof output === 'object');
  t.true(output.granules && Array.isArray(output.granules));
  t.true(output.granules.length === 1);
});
