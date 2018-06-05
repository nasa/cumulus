'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const { s3, recursivelyDeleteS3Bucket } = require('@cumulus/common/aws');
const migrations = require('../migrations');

test.before(async () => {
  process.env.internal = randomString();
  process.env.stackName = randomString();
  await s3().createBucket({ Bucket: process.env.internal }).promise();
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(process.env.internal);
});

test.serial('Run migrations the first time, it should run', async (t) => {
  const output = await migrations();
  t.is(output.length, 1);
  t.is(output[0], 'test_migration');

  const Key = `${process.env.stackName}/migrations/migration_0.js`;

  await s3().headObject({
    Bucket: process.env.internal,
    Key
  }).promise();
});

test.serial('Run the migration again, it should not run', async (t) => {
  const output = await migrations();
  t.is(output.length, 0);

  const Key = `${process.env.stackName}/migrations/migration_0.js`;

  await s3().headObject({
    Bucket: process.env.internal,
    Key
  }).promise();
});