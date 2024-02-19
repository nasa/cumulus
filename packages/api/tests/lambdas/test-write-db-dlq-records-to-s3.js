'use strict';

const uuidv4 = require('uuid/v4');
const test = require('ava');

const S3 = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');

const {
  determineExecutionName,
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
      cumulus_meta: {
        execution_name: message1Name,
      },
    }),
  };
  const message2Name = randomString(12);
  const message2 = {
    messageId: uuidv4(),
    body: JSON.stringify({
      cumulus_meta: {
        execution_name: message2Name,
      },
    }),
  };

  const recordsFixture = {
    Records: [message1, message2],
  };

  await handler(recordsFixture);

  t.is((await S3.listS3ObjectsV2({
    Bucket: t.context.bucket,
    Prefix: `${process.env.stackName}/dead-letter-archive/sqs/${message1Name}`,
  })).length, 1);
  t.is((await S3.listS3ObjectsV2({
    Bucket: t.context.bucket,
    Prefix: `${process.env.stackName}/dead-letter-archive/sqs/${message2Name}`,
  })).length, 1);
});

test.serial('write-db-dlq-records-to-s3 keeps all messages from identical execution', async (t) => {
  const messageName = randomString(12);
  const message1 = {
    messageId: uuidv4(),
    body: JSON.stringify({
      cumulus_meta: {
        execution_name: messageName,
      },
    }),
  };
  const message2 = {
    messageId: uuidv4(),
    body: JSON.stringify({
      cumulus_meta: {
        execution_name: messageName,
      },
    }),
  };

  const recordsFixture = {
    Records: [message1, message2],
  };

  await handler(recordsFixture);

  t.is((await S3.listS3ObjectsV2({
    Bucket: t.context.bucket,
    Prefix: `${process.env.stackName}/dead-letter-archive/sqs/${messageName}`,
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

test('determineExecutionName returns execution name if it exists in cumulus_meta', (t) => {
  const executionName = 'someExecutionName';
  t.is(determineExecutionName({
    cumulus_meta: {
      execution_name: executionName,
    },
  }),
  executionName);
});

test('determineExecutionName returns "unknown" if getExecutionName throws error', (t) => {
  t.is(determineExecutionName({}), 'unknown');
});
