'use strict';

const rewire = require('rewire');
const sinon = require('sinon');
const test = require('ava');

const { sleep } = require('@cumulus/common/util');

const consumer = rewire('../consumer');
const Consumer = consumer.Consumer;

const timeToReceiveMessages = 200; // ms
const timeLimitModifier = 50;
let testConsumer;

async function stubReceiveSQSMessages(_url, { numOfMessages }) {
  await sleep(timeToReceiveMessages);
  return Array.apply(null, { length: numOfMessages }).map(() => 'i am a message'); // eslint-disable-line prefer-spread
}
consumer.__set__('receiveSQSMessages', stubReceiveSQSMessages);
consumer.__set__('deleteSQSMessage', async () => true);
function processFn() {}

const sandbox = sinon.sandbox.create();
let batchSpy;
let messageSpy;

test.beforeEach(() => {
  // need to reinstantiate because this.now = Date.now()
  testConsumer = new Consumer({});
  testConsumer.messageLimit = 40; // initial messagelimit
  batchSpy = sandbox.spy(testConsumer, 'processMessages');
  messageSpy = sandbox.spy(testConsumer, 'processMessage');
});
test.afterEach.always(() => sandbox.restore());

test.serial('stops after timelimit', async (t) => {
  testConsumer.timeLimit = timeToReceiveMessages * 2 - timeLimitModifier;

  const result = await testConsumer.consume(processFn);
  t.is(result, 20);
  t.is(batchSpy.callCount, 2);
  t.is(messageSpy.callCount, 20);
});

test.serial('continues when timeLimit is is greater than time to receive', async (t) => {
  testConsumer.timeLimit = timeToReceiveMessages * 2 + timeLimitModifier;

  const result = await testConsumer.consume(processFn);
  t.is(result, 30);
  t.is(batchSpy.callCount, 3);
  t.is(messageSpy.callCount, 30);
});

test.serial('stops after messageLimit is reached', async (t) => {
  testConsumer.timeLimit = timeToReceiveMessages;
  testConsumer.messageLimit = 2;

  const result = await testConsumer.consume(processFn);
  t.is(result, 2);
  t.is(batchSpy.calledOnce, true);
  t.is(messageSpy.calledTwice, true);
});

test.serial('processMessages throws error on large batch sizes', async (t) => {
  await t.throws(testConsumer.processMessages(processFn, 20),
    'Cannot process more than 10 messages per function call. Received limit: 20');
});

test.serial('processMessages respects messageLimit', async (t) => {
  const result = await testConsumer.processMessages(processFn, 3);
  t.is(result, 3);
});

test.serial('processMessage returns count of 1 for success', async (t) => {
  const result = await testConsumer.processMessage('', processFn);
  t.is(result, 1);
});

test.serial('processMessage returns count of 0 for failure', async (t) => {
  const result = await testConsumer.processMessage('', () => {
    throw new Error('failed');
  });
  t.is(result, 0);
});
