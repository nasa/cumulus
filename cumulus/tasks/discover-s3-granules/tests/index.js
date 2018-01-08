/* eslint-disable no-param-reassign */
'use strict';

import test from 'ava';
import aws from '@cumulus/common/aws';
import testUtils from '@cumulus/common/test-utils';
import input from './fixtures/input.json';
import { handler } from '../index';

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
  deleteBucket(t.context.bucket);
});

test.cb('empty bucket results in empty granules array', (t) => {
  const newPayload = Object.assign({}, input);
  const bucketType = newPayload.config.bucket_type;
  newPayload.config.buckets[bucketType] = t.context.bucket;

  handler(newPayload, {}, (e, output) => {
    t.ifError(e);
    t.true(output && typeof output === 'object');
    t.true(output.granules && Array.isArray(output.granules));
    t.true(output.granules.length === 0);
    t.end();
  });
});

test.cb('filter using file_type', (t) => {
  const newPayload = Object.assign({}, input);
  const bucketType = newPayload.config.bucket_type;
  newPayload.config.buckets[bucketType] = t.context.bucket;
  newPayload.config.collection.granuleIdExtraction = '^(GW1AM2_(.*))\\.h5$';
  newPayload.config.file_type = '.h5';

  const keys = [
    `GW1AM2_${testUtils.randomString()}.h5`,
    `GW1AM2_${testUtils.randomString()}.txt`
  ];

  Promise.all(keys.map((key) =>
    putObject(t.context.bucket, key)
  )).then(() => {
    handler(newPayload, {}, (e, output) => {
      t.ifError(e);
      t.true(output && typeof output === 'object');
      t.true(output.granules && Array.isArray(output.granules));
      t.true(output.granules.length === 1);
      t.end();
    });
  });
});

test.cb('use file_prefix', (t) => {
  const newPayload = Object.assign({}, input);
  const bucketType = newPayload.config.bucket_type;
  newPayload.config.buckets[bucketType] = t.context.bucket;
  newPayload.config.collection.granuleIdExtraction = '^(GW1AM2_(.*))\\.h5$';
  newPayload.config.file_type = null;
  newPayload.config.file_prefix = 'GW1AM2_';

  const keys = [
    `GW1AM2_${testUtils.randomString()}.h5`,
    `${testUtils.randomString()}.h5`
  ];

  Promise.all(keys.map((key) =>
    putObject(t.context.bucket, key)
  )).then(() => {
    handler(newPayload, {}, (e, output) => {
      t.ifError(e);
      t.true(output && typeof output === 'object');
      t.true(output.granules && Array.isArray(output.granules));
      t.true(output.granules.length === 1);
      t.end();
    });
  });
});

test.cb('file_type and file_prefix', (t) => {
  const newPayload = Object.assign({}, input);
  const bucketType = newPayload.config.bucket_type;
  newPayload.config.buckets[bucketType] = t.context.bucket;
  newPayload.config.collection.granuleIdExtraction = '^(GW1AM2_(.*))\\.h5$';

  const keys = [
    `GW1AM2_${testUtils.randomString()}.h5`,
    `GW1AM2_${testUtils.randomString()}.txt`,
    `${testUtils.randomString()}.h5`
  ];

  Promise.all(keys.map((key) =>
    putObject(t.context.bucket, key)
  )).then(() => {
    handler(newPayload, {}, (e, output) => {
      t.ifError(e);
      t.true(output && typeof output === 'object');
      t.true(output.granules && Array.isArray(output.granules));
      t.true(output.granules.length === 1);
      t.end();
    });
  });
});
