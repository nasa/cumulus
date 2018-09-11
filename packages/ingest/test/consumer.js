'use strict';

const rewire = require('rewire');
const sinon = require('sinon');
const test = require('ava');
const consumer = rewire('../consumer');
const Consume = consumer.Consume;

/**
 * An asynchronous sleep/wait function
 *
 * @param {number} milliseconds - number of milliseconds to sleep
 * @returns {Promise<undefined>} undefined
 */
async function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const timeToReceiveMessages = 10;
let messageLimit = 3;
class MyTestConsumerClass extends Consume {
  constructor() {
    super();
    this.messageLimit = messageLimit;
    this.timeLimit = timeToReceiveMessages*2 + 100;
  }
}
let myTestConsumerClass;

async function stubReceiveSQSMessages() {
  await sleep(timeToReceiveMessages);
  return ['hi', 'bye'];
}
consumer.__set__('receiveSQSMessages', stubReceiveSQSMessages);
function processFn(msg) {};

const sandbox = sinon.sandbox.create();
let processSpy;

test.beforeEach(() => {
  // need to reinstantiate because this.now = Date.now()
  myTestConsumerClass = new MyTestConsumerClass();
  processSpy = sandbox.spy(myTestConsumerClass, 'processMessage');
})
test.afterEach.always(() => sandbox.restore());

test.serial('stops after timelimit', async (t) => {
  const result = await myTestConsumerClass.processMessages(processFn, messageLimit);
  t.is(result, 4);
  t.is(processSpy.callCount, 4);
});

test.serial('continues when timeLimit is is greater than time to receive', async (t) => {
  messageLimit = 10;
  myTestConsumerClass.timeLimit = timeToReceiveMessages*messageLimit + 100;

  const result = await myTestConsumerClass.processMessages(processFn, messageLimit);
  t.is(result, 10);
  t.is(processSpy.callCount, 10);
});

test.serial('stops after messageLimit is reached', async (t) => {
  myTestConsumerClass.timeLimit = timeToReceiveMessages*10 + 100;
  messageLimit = 2;

  const result = await myTestConsumerClass.processMessages(processFn, messageLimit);
  t.is(result, 2);
  t.is(processSpy.calledTwice, true);
});
