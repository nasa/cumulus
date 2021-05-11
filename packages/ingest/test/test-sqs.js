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

const { archiveSqsMessageToS3, deleteArchivedMessageFromS3 } = require('../sqs');
// Copied from @cumulus/api/lib/testUtils to avoid circular dependency

/**
 * create a source queue
 *
 * @param {string} queueNamePrefix - prefix of the queue name
 * @param {string} visibilityTimeout - visibility timeout for queue messages
 * @returns {Object} - {queueUrl: <url>} queue created
 */
async function createSqsQueues(
  queueNamePrefix,
  visibilityTimeout = '300'
) {
  // source queue
  const queueName = `${queueNamePrefix}Queue`;
  const queueParms = {
    QueueName: queueName,
    Attributes: {
      VisibilityTimeout: visibilityTimeout,
    },
  };

  const { QueueUrl: queueUrl } = await awsServices.sqs().createQueue(queueParms).promise();
  return { queueUrl };
}

test.before(async () => {
  process.env.system_bucket = randomString();
  process.env.stackName = randomString();
  await createBucket(process.env.system_bucket);
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.serial('archiveSqsMessageToS3 archives an SQS message', async (t) => {
  const queues = await createSqsQueues(randomString());
  const queueUrl = 'fakeQueueUrl';
  const body = { testdata: randomString() };
  const message = await SQS.sendSQSMessage(
    queues.queueUrl,
    body
  );
  const messages = await receiveSQSMessages(
    queues.queueUrl,
    { numOfMessages: 1, visibilityTimeout: 5 }
  );
  const key = `${process.env.stackName}/archived-incoming-messages/${message.MessageId}`;

  await Promise.all(messages.map(async (m) => archiveSqsMessageToS3(queueUrl, m)));

  const item = await s3().getObject({
    Bucket: process.env.system_bucket,
    Key: key,
  }).promise();

  t.deepEqual(body, JSON.parse(JSON.parse(item.Body.toString())));
});

test.serial('deleteArchivedMessageFromS3 deletes archived message in S3', async (t) => {
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
