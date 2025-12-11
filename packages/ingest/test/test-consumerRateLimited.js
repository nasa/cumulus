'use strict';

const sinon = require('sinon');
const test = require('ava');

const { sleep } = require('@cumulus/common');
const SQS = require('@cumulus/aws-client/SQS');
const SFN = require('@cumulus/aws-client/StepFunctions');

const { ConsumerRateLimited } = require('../consumerRateLimited');

const timeToReceiveMessages = 200; // ms
const sqsMessage = { Body: 'message', MessageId: 'id' };
const fakeQueueName = 'test-queue-url';
let testConsumer;

async function stubReceiveSQSMessages(_url, { numOfMessages }) {
  await sleep(timeToReceiveMessages);
  // eslint-disable-next-line prefer-spread
  return Array.apply(undefined, { length: numOfMessages }).map(() => sqsMessage);
}

sinon.stub(SQS, 'deleteSQSMessage').resolves();
sinon.stub(SQS, 'receiveSQSMessages').callsFake(stubReceiveSQSMessages);

function processFn() { }

const sandbox = sinon.createSandbox();

test.beforeEach(() => {
  // need to reinstantiate because this.now = Date.now()
  testConsumer = new ConsumerRateLimited({});
  testConsumer.messageLimit = 40; // initial messagelimit
  testConsumer.queueUrls = [fakeQueueName];
  SQS.deleteSQSMessage.resetHistory();
});
test.afterEach.always(() => sandbox.restore());

test.serial('consume exits when timeRemainingFunc is less than timeBuffer', async (t) => {
  testConsumer.timeBuffer = 500;
  testConsumer.timeRemainingFunc = () => 400;

  const result = await testConsumer.consume(processFn);
  t.is(result, 0);
});

test.serial('processMessages throws error on large batch sizes', async (t) => {
  const fakeMessage = { Body: 'message_body', MessageId: 'message_id' };
  await t.throwsAsync(
    () => testConsumer.processMessages(processFn, [fakeMessage, 'test-queue-url']),
    {
      message: 'Cannot process more than 10 messages per function call. Received limit: 20',
    }
  );
});

test.serial('processMessages respects rateLimitPerSecond', async (t) => {
  testConsumer.rateLimitPerSecond = 10; // 10 messages per second
  const numberOfMessages = 30;
  const minExpectedDurationInSeconds = numberOfMessages / testConsumer.rateLimitPerSecond;
  const startTime = Date.now();
  const result = await testConsumer.processMessages(
    processFn,
    new Array(numberOfMessages).fill([sqsMessage, fakeQueueName])
  );
  const endTime = Date.now();

  const durationInSeconds = (endTime - startTime) / 1000;

  t.is(result, numberOfMessages);
  t.true(durationInSeconds >= minExpectedDurationInSeconds);
});

test.serial('processMessage deletes message on ExecutionAlreadyExists error when deleteProcessedMessage is true', async (t) => {
  testConsumer.deleteProcessedMessage = true;

  const deleteSpy = SQS.deleteSQSMessage;

  const executionExistsError = new SFN.ExecutionAlreadyExists();
  const processFnWithError = () => {
    throw executionExistsError;
  };

  await testConsumer.processMessage(sqsMessage, processFnWithError, fakeQueueName);

  console.log(`deleteSQSMessage was called ${deleteSpy.callCount} times`);
  t.true(deleteSpy.calledOnce);
  t.true(deleteSpy.calledWith(fakeQueueName, sqsMessage.ReceiptHandle));
});

test.serial('processMessage does not delete message on ExecutionAlreadyExists error when deleteProcessedMessage is false', async (t) => {
  testConsumer.deleteProcessedMessage = false;

  const deleteSpy = SQS.deleteSQSMessage;

  const executionExistsError = new Error('ExecutionAlreadyExists: Execution already exists');
  const processFnWithError = () => {
    throw executionExistsError;
  };

  await testConsumer.processMessage(sqsMessage, processFnWithError, fakeQueueName);

  t.true(deleteSpy.notCalled);
});
