'use strict';

const test = require('ava');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');

const diagnostics = require('../../endpoints/file');

const buckets = [
  randomString(),
  randomString(),
  randomString()
]

test.after.always(async () => {
  const bucketPromises = buckets.map((bucket) =>
    aws.recursivelyDeleteS3Bucket(bucket));

  await Promise.all(bucketPromises);
});

test.before(async () => {
  const bucketPromises = buckets.map((bucket) =>
    aws.s3().createBucket({ Bucket: bucket }).promise());

  await Promise.all(bucketPromises);

  await aws.s3PutObject({
    Bucket: buckets[0],
    Key: 'cumulus.tfstate',
    Body: ''
  });

  await aws.s3PutObject({
    Bucket: buckets[0],
    Key: 'key/cumulus.tfstate',
    Body: ''
  });

  await aws.s3PutObject({
    Bucket: buckets[0],
    Key: 'cumulus.state',
    Body: ''
  });
});

test('test', async (t) => {
  const x = await diagnostics.listAllTfStateFiles();
  console.log(x);
});