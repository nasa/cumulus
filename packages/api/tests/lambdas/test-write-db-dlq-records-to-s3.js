'use strict';

const uuidv4 = require('uuid/v4');
const moment = require('moment');
const test = require('ava');

const S3 = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const {
  handler,
} = require('../../lambdas/write-db-dlq-records-to-s3.js');

test.before(async (t) => {
  t.context.bucket = randomString();
  await S3.createBucket(t.context.bucket);
  process.env.stackName = randomString();
  process.env.system_bucket = t.context.bucket;
});

test.after(async (t) => {
  delete process.env.system_bucket;
  delete process.env.stackName;
  await S3.recursivelyDeleteS3Bucket(t.context.bucket);
});

test.serial('write-db-dlq-records-to-s3 puts one file on S3 per SQS message', async (t) => {
  const message1Name = randomString(12);
  const message1 = {
    messageId: uuidv4(),
    body: JSON.stringify({
      detail: { executionArn: message1Name },
      time: '2024-03-11T18:58:27Z',
    }),
  };
  const message2Name = randomString(12);
  const message2 = {
    messageId: uuidv4(),
    body: JSON.stringify({
      detail: { executionArn: message2Name },
      time: '2024-03-12T18:58:27Z',
    }),
  };
  const message3Name = randomString(12);
  const message3 = {
    messageId: uuidv4(),
    body: JSON.stringify({
      detail: { executionArn: message3Name },
      time: '2024-03-13T18:58:27Z',
    }),
  };
  const message4Name = randomString(12);
  const message4 = {
    messageId: uuidv4(),
    body: JSON.stringify({
      detail: { executionArn: message4Name },
    }),
  };

  const recordsFixture = {
    Records: [message1, message2, message3, message4],
  };

  await handler(recordsFixture);
  t.is((await S3.listS3ObjectsV2({
    Bucket: t.context.bucket,
    Prefix: `${process.env.stackName}/dead-letter-archive/sqs/2024-03-11/${message1Name}`,
  })).length, 1);
  t.is((await S3.listS3ObjectsV2({
    Bucket: t.context.bucket,
    Prefix: `${process.env.stackName}/dead-letter-archive/sqs/2024-03-12/${message2Name}`,
  })).length, 1);
  t.is((await S3.listS3ObjectsV2({
    Bucket: t.context.bucket,
    Prefix: `${process.env.stackName}/dead-letter-archive/sqs/2024-03-13/${message3Name}`,
  })).length, 1);
  t.is((await S3.listS3ObjectsV2({
    Bucket: t.context.bucket,
    Prefix: `${process.env.stackName}/dead-letter-archive/sqs/${moment.utc().format('YYYY-MM-DD')}/${message4Name}`,
  })).length, 1);
});

test.serial('write-db-dlq-records-to-s3 keeps all messages from identical execution', async (t) => {
  const messageName = randomString(12);
  const time = '2024-03-11T18:58:27Z';
  const message1 = {
    messageId: uuidv4(),
    body: JSON.stringify({
      detail: { executionArn: messageName },
      time,
    }),
  };
  const message2 = {
    messageId: uuidv4(),
    body: JSON.stringify({
      detail: { executionArn: messageName },
      time,
    }),
  };

  const recordsFixture = {
    Records: [message1, message2],
  };

  await handler(recordsFixture);

  t.is((await S3.listS3ObjectsV2({
    Bucket: t.context.bucket,
    Prefix: `${process.env.stackName}/dead-letter-archive/sqs/2024-03-11/${messageName}`,
  })).length, 2);
});

test.serial('write-db-dlq-records-to-s3 throws error if stackName is not defined', async (t) => {
  delete process.env.stackName;
  await t.throwsAsync(
    handler({}),
    { message: 'Could not determine archive path as stackName env var is undefined.' }
  );
});

test.serial('write-db-dlq-records-to-s3 throws error if system bucket is not defined', async (t) => {
  delete process.env.system_bucket;
  await t.throwsAsync(
    handler({}),
    { message: 'System bucket env var is required.' }
  );
});
