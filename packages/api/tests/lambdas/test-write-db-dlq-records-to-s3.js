'use strict';

const uuidv4 = require('uuid/v4');
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
      'detail': {
        'name': message1Name,
      }
    }),
  };
  const message2Name = randomString(12);
  const message2 = {
    messageId: uuidv4(),
    body: JSON.stringify({
      'detail': {
        'name': message2Name,
      }
    }),
  };

  const recordsFixture = {
    Records: [message1, message2],
  };

  await handler(recordsFixture);

  t.deepEqual(await S3.getTextObject(
    t.context.bucket,
    `${process.env.stackName}/dead-letter-archive/sqs/${message1Name}-1.json`
  ), message1.body);
  t.deepEqual(await S3.getTextObject(
    t.context.bucket,
    `${process.env.stackName}/dead-letter-archive/sqs/${message2Name}-1.json`
  ), message2.body);
});

test.serial('write-db-dlq-records-to-s3 versions message from identical execution', async (t) => {
  const messageName = randomString(12);
  const message1 = {
    messageId: uuidv4(),
    body: JSON.stringify({
      'detail': {
        'name': messageName,
      }
    }),
  };
  const message2 = {
    messageId: uuidv4(),
    body: JSON.stringify({
      'detail': {
        'name': messageName,
      }
    }),
  };

  const recordsFixture = {
    Records: [message1, message2],
  };

  await handler(recordsFixture);

  t.deepEqual(await S3.getTextObject(
    t.context.bucket,
    `${process.env.stackName}/dead-letter-archive/sqs/${messageName}-1.json`
  ), message1.body);
  t.deepEqual(await S3.getTextObject(
    t.context.bucket,
    `${process.env.stackName}/dead-letter-archive/sqs/${messageName}-2.json`
  ), message2.body);
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
