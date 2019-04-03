'use strict';

const test = require('ava');

const bucketConfig = {
  private: { type: 'private', name: 'a-private-bucket' },
  public: { type: 'public', name: 'a-public-bucket' },
  protected: { type: 'protected', name: 'a-protected-bucket' },
  shared: { type: 'shared', name: 'a-shared-bucket' },
  internal: { type: 'internal', name: 'an-internal-bucket' },
  public2: { type: 'public', name: 'a-second-public-bucket' }
};

const {
  recursivelyDeleteS3Bucket,
  s3
} = require('../aws');
const { randomId } = require('../test-utils');
const bucketsConfigJsonObject = require('../bucketsConfigJsonObject');

const context = {};

test.before(async () => {
  context.systemBucket = randomId('systemBucket');
  context.stackName = randomId('stackName');
  await s3().createBucket({ Bucket: context.systemBucket }).promise();
  await s3().putObject({
    Bucket: context.systemBucket,
    Key: `${context.stackName}/workflows/buckets.json`,
    Body: JSON.stringify(bucketConfig)
  }).promise();
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(context.systemBucket);
});

test('reads default bucket.json values', async (t) => {
  process.env.system_bucket = context.systemBucket;
  process.env.stackName = context.stackName;

  const actualBucketObject = await bucketsConfigJsonObject();
  t.deepEqual(bucketConfig, actualBucketObject);
});

test('has understandable error messages for bad bucket name', async (t) => {
  process.env.system_bucket = 'bad-bucket';
  process.env.stackName = context.stackName;
  const location = `bad-bucket/${context.stackName}/workflows/buckets.json`;

  await t.throws(
    bucketsConfigJsonObject(),
    `Unable to read bucketsConfiguration from ${location}: The specified bucket does not exist`
  );
});

test('has understandable error messages for bad key', async (t) => {
  process.env.system_bucket = context.systemBucket;
  process.env.stackName = 'wrong-stackname';

  const location = `${context.systemBucket}/wrong-stackname/workflows/buckets.json`;

  await t.throws(
    bucketsConfigJsonObject(),
    `Unable to read bucketsConfiguration from ${location}: The specified key does not exist.`
  );
});
