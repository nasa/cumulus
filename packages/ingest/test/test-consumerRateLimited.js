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
  testConsumer = new ConsumerRateLimited({
    queueUrls: [fakeQueueName],
    timeRemainingFunc: () => 100,
    visibilityTimeout: 100,
    rateLimitPerSecond: 10,
    deleteProcessedMessage: true,
  });
  SQS.deleteSQSMessage.resetHistory();
});
test.afterEach.always(() => sandbox.restore());

test.serial('consume exits when timeRemainingFunc is less than timeBuffer', async (t) => {
  testConsumer.timeBuffer = 500;
  testConsumer.timeRemainingFunc = () => 400;

  const result = await testConsumer.consume(processFn);
  t.is(result, 0);
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

  t.true(deleteSpy.calledOnce);
  t.true(deleteSpy.calledWith(fakeQueueName, sqsMessage.ReceiptHandle));
});

test.serial('when no messages are available, consume polls the queue for new messages every this.waitTime between polls until timeRemainingFunc returns a value less than timeBuffer', async (t) => {
  // Since we're just testing the number of calls to fetchMessages, we can set waitTime to 0
  testConsumer.waitTime = 0;
  testConsumer.timeBuffer = 1;
  const timeSubtractedPerCall = 1;
  const initialTimeRemaining = 6;
  let timeRemaining = initialTimeRemaining;
  testConsumer.timeRemainingFunc = () => {
    timeRemaining -= timeSubtractedPerCall;
    return timeRemaining;
  };
  sandbox.stub(testConsumer, 'fetchMessages').resolves([]);

  await testConsumer.consume(processFn);

  t.is(testConsumer.fetchMessages.callCount, initialTimeRemaining - testConsumer.timeBuffer);
});
