'use strict';

const rewire = require('rewire');
const sinon = require('sinon');
const test = require('ava');
const consumer = rewire('../consumer');
const Consumer = consumer.Consumer;

const timeToReceiveMessages = 1 * 1000;
let testConsumer;

async function stubReceiveSQSMessages(_url, { numOfMessages }) {
  await sleep(timeToReceiveMessages);
  return Array.apply(null, { length: numOfMessages }).map(() => 'i am a message'); // eslint-disable-line prefer-spread
}
consumer.__set__('receiveSQSMessages', stubReceiveSQSMessages);
console.log(consumer.__get__('receiveSQSMessages'));
consumer.__set__('deleteSQSMessage', async () => true);
function processFn() {}

const sandbox = sinon.sandbox.create();
let processSpy;

test.beforeEach(() => {
  // need to reinstantiate because this.now = Date.now()
  testConsumer = new Consumer();
  processSpy = sandbox.spy(testConsumer, 'processMessage');
});
test.afterEach.always(() => sandbox.restore());

test.serial('stops after timelimit', async (t) => {
  testConsumer.messageLimit = 40;
  testConsumer.timeLimit = timeToReceiveMessages * 2 - 100;

  const result = await testConsumer.consume(processFn);
  t.is(result, 20);
  t.is(processSpy.callCount, 20);
});

test.serial('continues when timeLimit is is greater than time to receive', async (t) => {
  testConsumer.messageLimit = 40;
  testConsumer.timeLimit = timeToReceiveMessages * 2 + 100;

  const result = await testConsumer.consume(processFn);
  t.is(result, 30);
  t.is(processSpy.callCount, 30);
});

test.serial('stops after messageLimit is reached', async (t) => {
  testConsumer.timeLimit = timeToReceiveMessages;
  testConsumer.messageLimit = 2;

  const result = await testConsumer.consume(processFn);
  t.is(result, 2);
  t.is(processSpy.calledTwice, true);
});

test.serial('processMessages throws error on large batch sizes', async (t) => {
  await t.throws(testConsumer.processMessages(processFn, 20),
    'Cannot process more than 10 messages per function call. Received limit: 20');
});

test.serial('processMessages respect messageLimit', async (t) => {
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
