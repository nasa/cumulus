'use strict';

const test = require('ava');
const sinon = require('sinon');
const { recursivelyDeleteS3Bucket, s3, sqs } = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const { queueGranule } = require('../queue');

// Addresses CUMULUS-258
test('queueGranule generates unique exeuction names', async (t) => {
  // Setup
  const internalBucketName = randomString();
  const templateBucketName = randomString();
  const templateKey = randomString();

  // Create buckets
  await Promise.all([
    s3().createBucket({ Bucket: internalBucketName }).promise(),
    s3().createBucket({ Bucket: templateBucketName }).promise()
  ]);

  // Updload the message template
  const messageTemplate = {
    cumulus_meta: {
      state_machine: randomString()
    }
  };
  await s3().putObject({
    Bucket: templateBucketName,
    Key: templateKey,
    Body: JSON.stringify(messageTemplate)
  }).promise();

  // Create the queue
  const createQueueResponse = await sqs().createQueue({ QueueName: randomString() }).promise();
  const QueueUrl = createQueueResponse.QueueUrl;

  // Perform the test
  const granuleIds = [
    'MOD13Q1.A2016193.h05v13.006.2016215085023',
    'MOD13Q1.A2016193.h18v02.006.2016215090632'
  ];

  const event = {
    config: {
      buckets: { internal: internalBucketName },
      collection: { name: 'MOD13Q1' },
      queues: { startSF: QueueUrl },
      stack: randomString(),
      templates: { ParsePdr: `s3://${templateBucketName}/${templateKey}` }
    },
    input: {}
  };

  // Stop time and enqueue the granules
  // this.clock = sinon.useFakeTimers(Date.now());
  await Promise.all(granuleIds.map((granuleId) => {
    const granule = { granuleId, files: [] };
    return queueGranule(event, granule);
  }));
  // this.clock.restore();

  // Get messages from the queue
  const receiveMessageResponse = await sqs().receiveMessage({
    QueueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 1
  }).promise();
  const messages = receiveMessageResponse.Messages;

  // Create a Set from the execution names fetched from SQS
  const executionNames = messages
    .map((message) => JSON.parse(message.Body))
    .map((body) => body.cumulus_meta.execution_name);
  const setOfExecutionNames = new Set(executionNames);

  // Verify that there are two unique execution names
  t.is(setOfExecutionNames.size, 2);

  // Cleanup
  await Promise.all([
    recursivelyDeleteS3Bucket(internalBucketName),
    recursivelyDeleteS3Bucket(templateBucketName),
    sqs().deleteQueue({ QueueUrl }).promise()
  ]);
});
