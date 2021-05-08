'use strict';

const test = require('ava');
const range = require('lodash/range');

const awsServices = require('@cumulus/aws-client/services');
const SQS = require('@cumulus/aws-client/SQS');
const { randomString } = require('@cumulus/common/test-utils');
const { receiveSQSMessages } = require('@cumulus/aws-client/SQS');
const { s3 } = require('@cumulus/aws-client/services');
const {
  createBucket,
  s3PutObject,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { createSqsQueues } = require('@cumulus/api/lib/testUtils');

const { archiveSqsMessageToS3, deleteArchivedMessageFromS3 } = require('../sqs');

test.before(async () => {
  process.env.system_bucket = randomString();
  process.env.stackName = randomString();
  await createBucket(process.env.system_bucket);
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.serial('archiveSqsMessageToS3 archives all SQS messages', async (t) => {
  const queues = await createSqsQueues(randomString());
  await Promise.all(
    range(4).map(() =>
      SQS.sendSQSMessage(
        queues.queueUrl,
        { testdata: randomString() }
      ))
  );
  const messages = await receiveSQSMessages(
    queues.queueUrl,
    { numOfMessages: 4, visibilityTimeout: 5 }
  );
  const deriveKey = (m) => `${process.env.stackName}/archived-incoming-messages/${m.MessageId}`;
  const keys = messages.map((m) => deriveKey(m));

  await Promise.all(messages.map(async (m) => archiveSqsMessageToS3(m)));

  const items = await Promise.all(keys.map(async (k) =>
    (s3().getObject({
      Bucket: process.env.system_bucket,
      Key: k,
    })).promise()));

  const msgBody = (m) => t.truthy(JSON.parse(JSON.parse(m.Body.toString())));

  items.every(msgBody);
});

test.serial('deleteArchivedMessages deletes archived message in S3', async (t) => {
  const message = { testdata: randomString() };
  await createBucket(process.env.system_bucket);

  const sqsQueues = await createSqsQueues(randomString());
  const sqsMessage = await awsServices.sqs().sendMessage({
    QueueUrl: sqsQueues.queueUrl, MessageBody: JSON.stringify(message),
  }).promise();
  const messageId = sqsMessage.MessageId;
  const key = `${process.env.stackName}/archived-incoming-messages/${messageId}`;

  await s3PutObject({
    Bucket: process.env.system_bucket,
    Key: key,
    Body: JSON.stringify(sqsMessage.Body),
  });

  // Check that item exists in S3
  const item = await s3().getObject({
    Bucket: process.env.system_bucket,
    Key: key,
  }).promise();
  t.truthy(item);

  await deleteArchivedMessageFromS3(messageId);
  // Check that item does not exist in S3 and therefore throws an error
  await t.throwsAsync(s3().getObject({
    Bucket: process.env.system_bucket,
    Key: key,
  }).promise(), { code: 'NoSuchKey' });
});
