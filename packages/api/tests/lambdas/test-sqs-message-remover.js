'use strict';

const rewire = require('rewire');
const test = require('ava');
const get = require('lodash.get');

const aws = require('@cumulus/common/aws');
const { sleep } = require('@cumulus/common/util');
const { randomString } = require('@cumulus/common/test-utils');
const { createSqsQueues, getSqsQueueMessageCounts } = require('../../lib/testUtils');

const sqsMessageRemover = rewire('../../lambdas/sqs-message-remover');
const updateSqsQueue = sqsMessageRemover.__get__('updateSqsQueue');

const createEventSource = ({
  type = 'sqs',
  queueUrl = randomString(),
  receiptHandle = randomString(),
  deleteCompletedMessage = true,
  workflowName = randomString()
}) => ({
  type,
  messageId: randomString(),
  queueUrl,
  receiptHandle,
  receivedCount: 1,
  deleteCompletedMessage,
  workflow_name: workflowName
});

const sfEventSource = 'aws.states';
const createCloudwatchEventMessage = ({
  status,
  eventSource,
  currentWorkflowName,
  source = sfEventSource
}) => {
  const message = JSON.stringify({
    cumulus_meta: {
      execution_name: randomString()
    },
    meta: {
      eventSource,
      workflow_name: currentWorkflowName || get(eventSource, 'workflow_name', randomString())
    }
  });
  const detail = { status, input: message };
  return { source, detail };
};

const assertInvalidSqsQueueUpdateEvent = (t, output) =>
  t.is(output, 'Not a valid event for updating SQS queue');

test('sqsMessageRemover lambda does nothing for an event with a RUNNING status', async (t) => {
  const output = await updateSqsQueue(
    createCloudwatchEventMessage({
      status: 'RUNNING'
    })
  );

  assertInvalidSqsQueueUpdateEvent(t, output);
});

test('sqsMessageRemover lambda does nothing for a workflow message when eventSource.type is not set to sqs', async (t) => {
  let output = await updateSqsQueue(
    createCloudwatchEventMessage({
      status: 'SUCCEEDED'
    })
  );

  assertInvalidSqsQueueUpdateEvent(t, output);

  const eventSource = createEventSource({ type: 'kinesis' });
  output = await updateSqsQueue(
    createCloudwatchEventMessage({
      status: 'SUCCEEDED',
      eventSource
    })
  );

  assertInvalidSqsQueueUpdateEvent(t, output);
});

test('sqsMessageRemover lambda does nothing for a workflow message when eventSource.deleteCompletedMessage is not true', async (t) => {
  const eventSource = createEventSource({ deleteCompletedMessage: false });
  const output = await updateSqsQueue(
    createCloudwatchEventMessage({
      status: 'SUCCEEDED',
      eventSource
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
      currentWorkflowName: randomString()
    })
  );

  assertInvalidSqsQueueUpdateEvent(t, output);
});

test('sqsMessageRemover lambda removes message from queue when workflow succeeded', async (t) => {
  const sqsQueues = await createSqsQueues(randomString());
  await aws.sqs().sendMessage({
    QueueUrl: sqsQueues.queueUrl, MessageBody: JSON.stringify({ testdata: randomString() })
  }).promise();

  const sqsOptions = { numOfMessages: 10, visibilityTimeout: 120, waitTimeSeconds: 20 };
  const receiveMessageResponse = await aws.receiveSQSMessages(sqsQueues.queueUrl, sqsOptions);
  const { MessageId: messageId, ReceiptHandle: receiptHandle } = receiveMessageResponse[0];

  const eventSource = createEventSource({ messageId, receiptHandle, queueUrl: sqsQueues.queueUrl });
  await updateSqsQueue(
    createCloudwatchEventMessage({
      status: 'SUCCEEDED',
      eventSource
    })
  );

  const numberOfMessages = await getSqsQueueMessageCounts(sqsQueues.queueUrl);
  t.is(numberOfMessages.numberOfMessagesAvailable, 0);
  t.is(numberOfMessages.numberOfMessagesNotVisible, 0);

  await aws.sqs().deleteQueue({ QueueUrl: sqsQueues.queueUrl }).promise();
});

test('sqsMessageRemover lambda updates message visibilityTimeout when workflow failed', async (t) => {
  const sqsQueues = await createSqsQueues(randomString());
  await aws.sqs().sendMessage({
    QueueUrl: sqsQueues.queueUrl, MessageBody: JSON.stringify({ testdata: randomString() })
  }).promise();

  const sqsOptions = { numOfMessages: 10, visibilityTimeout: 120, waitTimeSeconds: 20 };
  const receiveMessageResponse = await aws.receiveSQSMessages(sqsQueues.queueUrl, sqsOptions);
  const { MessageId: messageId, ReceiptHandle: receiptHandle } = receiveMessageResponse[0];

  const eventSource = createEventSource({ messageId, receiptHandle, queueUrl: sqsQueues.queueUrl });
  await updateSqsQueue(
    createCloudwatchEventMessage({
      status: 'FAILED',
      eventSource
    })
  );

  let numberOfMessages = await getSqsQueueMessageCounts(sqsQueues.queueUrl);
  t.is(numberOfMessages.numberOfMessagesAvailable, 0);
  t.is(numberOfMessages.numberOfMessagesNotVisible, 1);

  await sleep(5 * 1000);
  numberOfMessages = await getSqsQueueMessageCounts(sqsQueues.queueUrl);
  t.is(numberOfMessages.numberOfMessagesAvailable, 1);
  t.is(numberOfMessages.numberOfMessagesNotVisible, 0);

  await aws.sqs().deleteQueue({ QueueUrl: sqsQueues.queueUrl }).promise();
});
