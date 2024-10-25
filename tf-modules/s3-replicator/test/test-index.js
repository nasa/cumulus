'use strict';

const test = require('ava');
const { randomId } = require('@cumulus/common/test-utils');
const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { handler } = require('..');

test.before(async (t) => {
  t.context.sourceRegion = 'us-west-2';
  t.context.targetRegion = 'us-east-2';

  process.env.AWS_REGION = t.context.sourceRegion;

  t.context.sourceBucket = randomId('source-bucket');
  t.context.sourceKey = randomId('sourceKey');
  await s3().createBucket({ Bucket: t.context.sourceBucket });
  await s3().putObject({
    Bucket: t.context.sourceBucket,
    Key: t.context.sourceKey,
    Body: randomId('testdata'),
  });

  t.context.targetBucketSameRegion = randomId('target-bucket-same-region');
  t.context.targetBucket = randomId('target-bucket');
  await s3().createBucket({ Bucket: t.context.targetBucketSameRegion });
  await s3({ region: t.context.targetRegion })
    .createBucket({ Bucket: t.context.targetBucket });

  t.context.targetPrefix = randomId('targetPrefix');
});

test.after.always(async (t) => {
  await Promise.all(
    [t.context.sourceBucket, t.context.targetBucketSameRegion].map(recursivelyDeleteS3Bucket)
  );
  process.env.AWS_REGION = t.context.targetRegion;
  await recursivelyDeleteS3Bucket(t.context.targetBucket);
});

test('handler returns immediately on non-create event', async (t) => {
  const event = {
    Records: [{
      eventName: 'ObjectRemoved:Delete',
    }],
  };
  const output = await handler(event, {});
  t.deepEqual(output, [null]);
});

test.serial('handler replicates file to target bucket in the same region', async (t) => {
  process.env.TARGET_BUCKET = t.context.targetBucketSameRegion;
  process.env.TARGET_PREFIX = t.context.targetPrefix;
  const s3Event = {
    Records: [
      {
        eventSource: 'aws:s3',
        awsRegion: 'us-west-2',
        eventName: 'ObjectCreated:Put',
        s3: {
          bucket: {
            name: t.context.sourceBucket,
          },
          object: {
            key: t.context.sourceKey,
          },
        },
      },
    ],
  };

  const output = await handler(s3Event, {});
  t.is(output.length, 1);
});

// note: localstack doesn't fail the request even target region is not set,
// so this can not replace the real test in AWS
test.serial('handler replicates file to target bucket in the different region', async (t) => {
  process.env.TARGET_REGION = t.context.targetRegion;
  process.env.TARGET_BUCKET = t.context.targetBucket;
  process.env.TARGET_PREFIX = t.context.targetPrefix;
  const s3Event = {
    Records: [
      {
        eventSource: 'aws:s3',
        awsRegion: 'us-west-2',
        eventName: 'ObjectCreated:Put',
        s3: {
          bucket: {
            name: t.context.sourceBucket,
          },
          object: {
            key: t.context.sourceKey,
          },
        },
      },
    ],
  };

  const output = await handler(s3Event, {});
  t.is(output.length, 1);
});
