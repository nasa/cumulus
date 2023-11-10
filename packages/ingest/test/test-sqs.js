'use strict';

const test = require('ava');

const awsServices = require('@cumulus/aws-client/services');
const SQS = require('@cumulus/aws-client/SQS');
const { randomString } = require('@cumulus/common/test-utils');
const { receiveSQSMessages } = require('@cumulus/aws-client/SQS');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
  s3ObjectExists,
  s3PutObject,
  getJsonS3Object,
} = require('@cumulus/aws-client/S3');

const { archiveSqsMessageToS3, deleteArchivedMessageFromS3, getS3KeyForArchivedMessage } = require('../sqs');
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
  return { queueName, queueUrl };
}

test.before(async (t) => {
  process.env.system_bucket = randomString();
  process.env.stackName = randomString();
  t.context.stackName = process.env.stackName;
  await createBucket(process.env.system_bucket);
  t.context.queues = await createSqsQueues(randomString());
});

test.after.always(async (t) => {
  await SQS.deleteQueue(t.context.queues.queueUrl);
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.skip('archiveSqsMessageToS3 archives an SQS message', async (t) => {
  const { stackName, queues } = t.context;
  const body = { testdata: randomString() };
  const message = await SQS.sendSQSMessage(
    queues.queueUrl,
    body
  );
  const receivedMessage = await receiveSQSMessages(
    queues.queueUrl,
    { numOfMessages: 1, visibilityTimeout: 5 }
  );
  const key = getS3KeyForArchivedMessage(stackName, message.MessageId, queues.queueName);

  await archiveSqsMessageToS3(queues.queueUrl, receivedMessage[0]);

  const s3data = await getJsonS3Object(process.env.system_bucket, key);
  t.deepEqual(body, s3data);
});

test.skip('archiveSqsMessageToS3 does not archive message if queueName cannot be derived from queueUrl', async (t) => {
  const { queues } = t.context;
  const body = { testdata: randomString() };
  await SQS.sendSQSMessage(
    queues.queueUrl,
    body
  );
  const receivedMessage = await receiveSQSMessages(
    queues.queueUrl,
    { numOfMessages: 1, visibilityTimeout: 5 }
  );

  const queueUrl = '';

  await t.throwsAsync(
    archiveSqsMessageToS3(queueUrl, receivedMessage[0]),
    { message: `Unable to determine queueName from ${queueUrl}` }
  );
});

test.skip('deleteArchivedMessageFromS3 deletes archived message in S3', async (t) => {
  const { queues } = t.context;
  const message = { testdata: randomString() };
  await createBucket(process.env.system_bucket);

  const sqsMessage = await awsServices.sqs().sendMessage({
    QueueUrl: queues.queueUrl, MessageBody: JSON.stringify(message),
  }).promise();
  const messageId = sqsMessage.MessageId;
  const key = getS3KeyForArchivedMessage(process.env.stackName, messageId, queues.queueName);

  await s3PutObject({
    Bucket: process.env.system_bucket,
    Key: key,
    Body: sqsMessage.Body,
  });

  // Check that item exists in S3
  t.true(await s3ObjectExists({
    Bucket: process.env.system_bucket,
    Key: key,
  }));

  await deleteArchivedMessageFromS3(messageId, queues.queueUrl);

  // Check that item no longer exists
  t.false(await s3ObjectExists({
    Bucket: process.env.system_bucket,
    Key: key,
  }));
});

test.skip('deleteArchivedMessageFromS3 does delete archived message if queueName cannot be derived from queueUrl', async (t) => {
  const { queues } = t.context;
  const message = { testdata: randomString() };
  await createBucket(process.env.system_bucket);

  const sqsMessage = await awsServices.sqs().sendMessage({
    QueueUrl: queues.queueUrl, MessageBody: JSON.stringify(message),
  }).promise();
  const messageId = sqsMessage.MessageId;
  const key = getS3KeyForArchivedMessage(process.env.stackName, messageId, queues.queueName);
  const queueUrl = '';

  await s3PutObject({
    Bucket: process.env.system_bucket,
    Key: key,
    Body: sqsMessage.Body,
  });

  // Check that item exists in S3
  t.true(await s3ObjectExists({
    Bucket: process.env.system_bucket,
    Key: key,
  }));

  await t.throwsAsync(
    deleteArchivedMessageFromS3(messageId, queueUrl),
    { message: `Unable to determine queueName from ${queueUrl}` }
  );
  // Check that item still exists in S3
  t.true(await s3ObjectExists({
    Bucket: process.env.system_bucket,
    Key: key,
  }));
});
