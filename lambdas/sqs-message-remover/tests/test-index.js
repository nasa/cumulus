'use strict';

const test = require('ava');
const get = require('lodash/get');

const awsServices = require('@cumulus/aws-client/services');
const { getQueueNameFromUrl, receiveSQSMessages } = require('@cumulus/aws-client/SQS');
const { sleep } = require('@cumulus/common');
const { randomString } = require('@cumulus/common/test-utils');
const {
  createBucket,
  s3ObjectExists,
  s3PutObject,
} = require('@cumulus/aws-client/S3');
const { getS3KeyForArchivedMessage } = require('@cumulus/ingest/sqs');

const { updateSqsQueue } = require('..');

// TODO: Copied from @cumulus/api/lib/testUtils to avoid the dependency, but
// these helpers should probably have a better home?

/**
 * create a dead-letter queue and a source queue
 *
 * @param {string} queueNamePrefix - prefix of the queue name
 * @param {number} maxReceiveCount
 *   Maximum number of times message can be removed before being sent to DLQ
 * @param {string} visibilityTimeout - visibility timeout for queue messages
 * @returns {Object} - {deadLetterQueueUrl: <url>, queueUrl: <url>} queues created
 */
async function createSqsQueues(
  queueNamePrefix,
  maxReceiveCount = 3,
  visibilityTimeout = '300'
) {
  // dead letter queue
  const deadLetterQueueName = `${queueNamePrefix}DeadLetterQueue`;
  const deadLetterQueueParms = {
    QueueName: deadLetterQueueName,
    Attributes: {
      VisibilityTimeout: visibilityTimeout,
    },
  };
  const { QueueUrl: deadLetterQueueUrl } = await awsServices.sqs()
    .createQueue(deadLetterQueueParms);
  const qAttrParams = {
    QueueUrl: deadLetterQueueUrl,
    AttributeNames: ['QueueArn'],
  };
  const { Attributes: { QueueArn: deadLetterQueueArn } } = await awsServices.sqs()
    .getQueueAttributes(qAttrParams);

  // source queue
  const queueName = `${queueNamePrefix}Queue`;
  const queueParms = {
    QueueName: queueName,
    Attributes: {
      RedrivePolicy: JSON.stringify({
        deadLetterTargetArn: deadLetterQueueArn,
        maxReceiveCount,
      }),
      VisibilityTimeout: visibilityTimeout,
    },
  };

  const { QueueUrl: queueUrl } = await awsServices.sqs().createQueue(queueParms);
  return { deadLetterQueueUrl, queueUrl };
}

/**
 * get message counts of the given SQS queue
 *
 * @param {string} queueUrl - SQS queue URL
 * @returns {Object} - message counts
 * {numberOfMessagesAvailable: <number>, numberOfMessagesNotVisible: <number>}
 */
async function getSqsQueueMessageCounts(queueUrl) {
  const qAttrParams = {
    QueueUrl: queueUrl,
    AttributeNames: ['All'],
  };
  const attributes = await awsServices.sqs().getQueueAttributes(qAttrParams);
  const {
    ApproximateNumberOfMessages: numberOfMessagesAvailable,
    ApproximateNumberOfMessagesNotVisible: numberOfMessagesNotVisible,
  } = attributes.Attributes;

  return {
    numberOfMessagesAvailable: Number.parseInt(numberOfMessagesAvailable, 10),
    numberOfMessagesNotVisible: Number.parseInt(numberOfMessagesNotVisible, 10),
  };
}

const createEventSource = ({
  type = 'sqs',
  queueUrl = randomString(),
  receiptHandle = randomString(),
  deleteCompletedMessage = true,
  workflowName = randomString(),
}) => ({
  type,
  messageId: randomString(),
  queueUrl,
  receiptHandle,
  receivedCount: 1,
  deleteCompletedMessage,
  workflow_name: workflowName,
});

const sfEventSource = 'aws.states';
const createCloudwatchEventMessage = ({
  status,
  eventSource,
  currentWorkflowName,
  source = sfEventSource,
}) => {
  const message = JSON.stringify({
    cumulus_meta: {
      execution_name: randomString(),
    },
    meta: {
      eventSource,
      workflow_name: currentWorkflowName || get(eventSource, 'workflow_name', randomString()),
    },
  });
  const detail = { status, input: message };
  return { source, detail };
};

const assertInvalidSqsQueueUpdateEvent = (t, output) =>
  t.is(output, 'Not a valid event for updating SQS queue');

test('sqsMessageRemover lambda does nothing for an event with a RUNNING status', async (t) => {
  const output = await updateSqsQueue(
    createCloudwatchEventMessage({
      status: 'RUNNING',
    })
  );

  assertInvalidSqsQueueUpdateEvent(t, output);
});

test('sqsMessageRemover lambda does nothing for a workflow message when eventSource.type is not set to sqs', async (t) => {
  let output = await updateSqsQueue(
    createCloudwatchEventMessage({
      status: 'SUCCEEDED',
    })
  );

  assertInvalidSqsQueueUpdateEvent(t, output);

  const eventSource = createEventSource({ type: 'kinesis' });
  output = await updateSqsQueue(
    createCloudwatchEventMessage({
      status: 'SUCCEEDED',
      eventSource,
    })
  );

  assertInvalidSqsQueueUpdateEvent(t, output);
});

test('sqsMessageRemover lambda does nothing for a workflow message when eventSource.deleteCompletedMessage is not true', async (t) => {
  t.true(Math.random() > 0.1);
  const eventSource = createEventSource({ deleteCompletedMessage: false });
  const output = await updateSqsQueue(
    createCloudwatchEventMessage({
      status: 'SUCCEEDED',
      eventSource,
    })
  );

  assertInvalidSqsQueueUpdateEvent(t, output);
});

test('sqsMessageRemover lambda does nothing for a workflow message when eventSource.workflow_name is not current workflow', async (t) => {
  const eventSource = createEventSource({});
  const output = await updateSqsQueue(
    createCloudwatchEventMessage({
      status: 'SUCCEEDED',
      eventSource,
      currentWorkflowName: randomString(),
    })
  );

  assertInvalidSqsQueueUpdateEvent(t, output);
});

test('sqsMessageRemover lambda removes message from queue when workflow succeeded', async (t) => {
  process.env.system_bucket = randomString();
  await createBucket(process.env.system_bucket);

  const sqsQueues = await createSqsQueues(randomString());
  await awsServices.sqs().sendMessage({
    QueueUrl: sqsQueues.queueUrl, MessageBody: JSON.stringify({ testdata: randomString() }),
  });

  const sqsOptions = { numOfMessages: 10, visibilityTimeout: 120, waitTimeSeconds: 20 };
  const receiveMessageResponse = await receiveSQSMessages(sqsQueues.queueUrl, sqsOptions);
  const { MessageId: messageId, ReceiptHandle: receiptHandle } = receiveMessageResponse[0];

  const eventSource = createEventSource({ messageId, receiptHandle, queueUrl: sqsQueues.queueUrl });
  await updateSqsQueue(
    createCloudwatchEventMessage({
      status: 'SUCCEEDED',
      eventSource,
    })
  );

  const numberOfMessages = await getSqsQueueMessageCounts(sqsQueues.queueUrl);
  t.is(numberOfMessages.numberOfMessagesAvailable, 0);
  t.is(numberOfMessages.numberOfMessagesNotVisible, 0);

  await awsServices.sqs().deleteQueue({ QueueUrl: sqsQueues.queueUrl });
});

test('sqsMessageRemover lambda updates message visibilityTimeout when workflow failed', async (t) => {
  const sqsQueues = await createSqsQueues(randomString());
  await awsServices.sqs().sendMessage({
    QueueUrl: sqsQueues.queueUrl, MessageBody: JSON.stringify({ testdata: randomString() }),
  });

  const sqsOptions = { numOfMessages: 10, visibilityTimeout: 120, waitTimeSeconds: 20 };
  const receiveMessageResponse = await receiveSQSMessages(sqsQueues.queueUrl, sqsOptions);
  const { MessageId: messageId, ReceiptHandle: receiptHandle } = receiveMessageResponse[0];

  const eventSource = createEventSource({ messageId, receiptHandle, queueUrl: sqsQueues.queueUrl });
  await updateSqsQueue(
    createCloudwatchEventMessage({
      status: 'FAILED',
      eventSource,
    })
  );

  let numberOfMessages = await getSqsQueueMessageCounts(sqsQueues.queueUrl);
  t.is(numberOfMessages.numberOfMessagesAvailable, 0);
  t.is(numberOfMessages.numberOfMessagesNotVisible, 1);

  await sleep(6 * 1000);
  numberOfMessages = await getSqsQueueMessageCounts(sqsQueues.queueUrl);
  t.is(numberOfMessages.numberOfMessagesAvailable, 1);
  t.is(numberOfMessages.numberOfMessagesNotVisible, 0);

  await awsServices.sqs().deleteQueue({ QueueUrl: sqsQueues.queueUrl });
});

test.serial('sqsMessageRemover lambda removes message from S3 when workflow succeeded', async (t) => {
  process.env.system_bucket = randomString();
  process.env.stackName = randomString();
  await createBucket(process.env.system_bucket);

  const sqsQueues = await createSqsQueues(randomString());
  const msgBody = JSON.stringify({ testdata: randomString() });

  await awsServices.sqs().sendMessage({
    QueueUrl: sqsQueues.queueUrl, MessageBody: msgBody,
  });
  const sqsOptions = { numOfMessages: 10, visibilityTimeout: 120, waitTimeSeconds: 20 };
  const receiveMessageResponse = await receiveSQSMessages(sqsQueues.queueUrl, sqsOptions);
  const { MessageId: messageId, ReceiptHandle: receiptHandle } = receiveMessageResponse[0];

  const eventSource = createEventSource({ messageId, receiptHandle, queueUrl: sqsQueues.queueUrl });
  const eventMessage = createCloudwatchEventMessage({
    status: 'SUCCEEDED',
    eventSource,
  });
  const queueName = getQueueNameFromUrl(sqsQueues.queueUrl);
  const key = getS3KeyForArchivedMessage(process.env.stackName, eventSource.messageId, queueName);

  await s3PutObject({
    Bucket: process.env.system_bucket,
    Key: key,
    Body: msgBody,
  });

  await updateSqsQueue(eventMessage);

  // Check that item no longer exists
  t.false(await s3ObjectExists({
    Bucket: process.env.system_bucket,
    Key: key,
  }));
});
