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

const timeLimit = 10;
let messageLimit = 3;
class MyTestConsumerClass extends Consume {
  constructor() {
    super()
    this.queueUrl = 'sqs.test';
    this.messageLimit = messageLimit;
    this.timeLimit = timeLimit;
    this.now = Date.now();
    this.endConsume = false;    
  }
}

async function stubReceiveSQSMessages() {
  await sleep(timeLimit*2);
  return ['hi'];
}
consumer.__set__('receiveSQSMessages', stubReceiveSQSMessages);
function processFn(msg) {};

const sandbox = sinon.sandbox.create();
let processSpy;

test.afterEach.always(() => sandbox.restore());

test.serial('stops after timelimit', async (t) => {
  const myTestConsumerClass = new MyTestConsumerClass();
  processSpy = sandbox.spy(myTestConsumerClass, 'processMessage');

  const result = await myTestConsumerClass.processMessages(processFn, messageLimit);
  t.is(result, 1);
  t.is(processSpy.calledOnce, true);
});

test.serial('continues when timeLimit is is greater than time to receive', async (t) => {
  const myTestConsumerClass = new MyTestConsumerClass();
  processSpy = sandbox.spy(myTestConsumerClass, 'processMessage');
  myTestConsumerClass.timeLimit = timeLimit*10;

  const result = await myTestConsumerClass.processMessages(processFn, messageLimit);
  t.is(result, 3);
  t.is(processSpy.callCount, 3);
});

test.serial('stops after messageLimit is reached', async (t) => {
  const myTestConsumerClass = new MyTestConsumerClass();
  processSpy = sandbox.spy(myTestConsumerClass, 'processMessage');
  myTestConsumerClass.timeLimit = timeLimit*10;
  messageLimit = 1;

  const result = await myTestConsumerClass.processMessages(processFn, messageLimit);
  t.is(result, 1);
  t.is(processSpy.calledOnce, true);
});
