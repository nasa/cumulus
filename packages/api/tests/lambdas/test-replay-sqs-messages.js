'use strict';

const test = require('ava');
const uuidv4 = require('uuid/v4');

const S3 = require('@cumulus/aws-client/S3');
const { s3PutObject } = require('@cumulus/aws-client/S3');
const { getS3KeyForArchivedMessage } = require('@cumulus/ingest/sqs');
const { randomString } = require('@cumulus/common/test-utils');

const { createSqsQueues, getSqsQueueMessageCounts } = require('../../lib/testUtils');
const {
  replaySqsMessages,
} = require('../../lambdas/replay-sqs-messages');

test.before(async (t) => {
  process.env.system_bucket = randomString();
  t.context.system_bucket = process.env.system_bucket;
  await S3.createBucket(t.context.system_bucket);
});

test.beforeEach(async (t) => {
  process.env.stackName = 'test-stack';
  t.context.stackName = process.env.stackName;

  const queues = await createSqsQueues(randomString());
  t.context.queueUrl = queues.queueUrl;
  t.context.queueName = queues.queueName;

  const message1 = { id: uuidv4(), Body: JSON.stringify({ testdata: randomString() }) };
  t.context.message1 = message1;

  const key1 = getS3KeyForArchivedMessage(t.context.stackName, message1.id, queues.queueName);
  await s3PutObject({
    Bucket: process.env.system_bucket,
    Key: key1,
    Body: message1.Body,
  });
});

test.after(async (t) => {
  await S3.recursivelyDeleteS3Bucket(t.context.system_bucket);
});

test('replaySqsMessages queues messages to SQS for each archived message', async (t) => {
  const { message1, queueUrl } = t.context;
  const event = {
    queueName: t.context.queueName,
  };
  const expected = [JSON.parse(message1.Body)];

  const replay = (await replaySqsMessages(event));
  const {
    numberOfMessagesAvailable,
    numberOfMessagesNotVisible,
  } = await getSqsQueueMessageCounts(queueUrl);
  t.is(numberOfMessagesAvailable, 1);
  t.is(numberOfMessagesNotVisible, 0);
  t.deepEqual(replay, expected);
});
