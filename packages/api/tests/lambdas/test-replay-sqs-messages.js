'use strict';

const test = require('ava');
const uuidv4 = require('uuid/v4');

const { deleteQueue } = require('@cumulus/aws-client/SQS');
const { createBucket, recursivelyDeleteS3Bucket, s3PutObject } = require('@cumulus/aws-client/S3');
const { getS3KeyForArchivedMessage } = require('@cumulus/ingest/sqs');
const { randomString } = require('@cumulus/common/test-utils');

const { createSqsQueues, getSqsQueueMessageCounts } = require('../../lib/testUtils');
const {
  getArchivedMessagesFromQueue,
  replaySqsMessages,
} = require('../../lambdas/replay-sqs-messages');

test.before(async (t) => {
  process.env.system_bucket = randomString();
  t.context.system_bucket = process.env.system_bucket;
  await createBucket(t.context.system_bucket);
});

test.beforeEach(async (t) => {
  process.env.stackName = 'test-stack';
  t.context.stackName = process.env.stackName;

  const queues = await createSqsQueues(randomString());
  t.context.queueUrl = queues.queueUrl;
  t.context.queueName = queues.queueName;

  const validMessage = { id: uuidv4(), Body: JSON.stringify({ testdata: randomString() }) };
  t.context.validMessage = validMessage;
  const key1 = getS3KeyForArchivedMessage(t.context.stackName, validMessage.id, queues.queueName);
  await s3PutObject({
    Bucket: process.env.system_bucket,
    Key: key1,
    Body: validMessage.Body,
  });
});

test.afterEach(async (t) => {
  await deleteQueue(t.context.queueUrl);
});

test.after(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.system_bucket);
});

test('replaySqsMessages queues messages to SQS for each archived message', async (t) => {
  const { queueName, queueUrl, validMessage } = t.context;

  const event = {
    queueName,
  };
  const expected = [JSON.parse(validMessage.Body)];

  const replay = (await replaySqsMessages(event));
  const {
    numberOfMessagesAvailable,
    numberOfMessagesNotVisible,
  } = await getSqsQueueMessageCounts(queueUrl);
  t.is(numberOfMessagesAvailable, 1);
  t.is(numberOfMessagesNotVisible, 0);
  t.deepEqual(replay, expected);
});

test('getArchivedMessagesFromQueue only returns valid messages', async (t) => {
  const { queueName, validMessage } = t.context;
  const invalidMessage = { id: uuidv4(), Body: randomString() };
  const key2 = getS3KeyForArchivedMessage(t.context.stackName, invalidMessage.id, queueName);
  await s3PutObject({
    Bucket: process.env.system_bucket,
    Key: key2,
    Body: invalidMessage.Body,
  });

  const expected = [JSON.parse(validMessage.Body)];

  const retrievedMessages = await getArchivedMessagesFromQueue(queueName);
  t.deepEqual(retrievedMessages, expected);
});

test('getArchivedMessagesFromQueue gets archived messages from S3 with the provided queueName', async (t) => {
  const { queueName, validMessage } = t.context;
  const messages = await getArchivedMessagesFromQueue(queueName);
  const expected = [JSON.parse(validMessage.Body)];
  t.deepEqual(messages, expected);
});

test('getArchivedMessagesFromQueue returns no messages if queueName does not exist', async (t) => {
  const messages = await getArchivedMessagesFromQueue(randomString());
  t.deepEqual(messages, []);
});
