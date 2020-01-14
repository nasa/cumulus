'use strict';

const test = require('ava');

const { randomString } = require('@cumulus/common/test-utils');
const {
  fileExists, recursivelyDeleteS3Bucket, deleteS3Object
} = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const { crypto } = require('../lib/crypto');

const bucket = randomString();
const stack = randomString();
const prefix = `${stack}/crypto`;
const s3Client = s3();

async function keyVersions() {
  const vals = await Promise.all([
    s3Client.headObject({ Bucket: bucket, Key: `${prefix}/public.pub` }).promise(),
    s3Client.headObject({ Bucket: bucket, Key: `${prefix}/private.pem` }).promise()
  ]);
  return vals.map((v) => v.VersionId);
}

test.before(async (t) => { //eslint-disable-line no-unused-vars
  await s3Client.createBucket({ Bucket: bucket }).promise();
  // enable versioning to test whether new copies are created
  await s3Client.putBucketVersioning({
    Bucket: bucket,
    VersioningConfiguration: {
      Status: 'Enabled'
    }
  }).promise();
});

test.after(async (t) => { //eslint-disable-line no-unused-vars
  // disable versioning to auto-delete old versions
  await s3Client.putBucketVersioning({
    Bucket: bucket,
    VersioningConfiguration: {
      Status: 'Disabled'
    }
  }).promise();
  await recursivelyDeleteS3Bucket(bucket);
});

test.serial('crypto creates keys when they do not exist', async (t) => {
  t.false(await fileExists(bucket, `${prefix}/public.pub`));
  t.false(await fileExists(bucket, `${prefix}/private.pem`));
  await crypto(stack, bucket, s3Client);
  t.truthy(await fileExists(bucket, `${prefix}/public.pub`));
  t.truthy(await fileExists(bucket, `${prefix}/private.pem`));
});

test.serial('crypto creates new key pair when either file does not exist', async (t) => {
  const oldVersions = await keyVersions();
  await deleteS3Object(bucket, `${prefix}/public.pub`);
  await crypto(stack, bucket, s3Client);
  const newVersions = await keyVersions();
  t.notDeepEqual(oldVersions, newVersions);
  await deleteS3Object(bucket, `${prefix}/private.pem`);
  await crypto(stack, bucket, s3Client);
  t.notDeepEqual(newVersions, await keyVersions());
});

test.serial('crypto does not create new keys when they do exist', async (t) => {
  const oldVersions = await keyVersions();
  await crypto(stack, bucket, s3Client);
  t.deepEqual(oldVersions, await keyVersions());
});
