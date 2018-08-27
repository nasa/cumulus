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
const messageLimit = 2;
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
let receiveSpy;

test.afterEach.always(() => sandbox.restore());

test.serial('stops after timelimit', async (t) => {
  const myTestConsumerClass = new MyTestConsumerClass();
  receiveSpy = sandbox.spy(myTestConsumerClass, 'processMessage');

  const result = await myTestConsumerClass.processMessages(processFn, messageLimit);
  t.is(result, 1);
  t.is(receiveSpy.calledOnce, true);
});

test.serial('it continues when timeLimit is is greater than time to receive', async (t) => {
  const myTestConsumerClass = new MyTestConsumerClass();
  receiveSpy = sandbox.spy(myTestConsumerClass, 'processMessage');
  myTestConsumerClass.timeLimit = timeLimit*3;

  const result = await myTestConsumerClass.processMessages(processFn, messageLimit);
  t.is(result, 2);
  t.is(receiveSpy.calledTwice, true);
});

test.serial('it stops after messageLimit is reached', async (t) => {
  const myTestConsumerClass = new MyTestConsumerClass();
  receiveSpy = sandbox.spy(myTestConsumerClass, 'processMessage');
  myTestConsumerClass.timeLimit = timeLimit*3;
  myTestConsumerClass.messageLimit = 1;

  const result = await myTestConsumerClass.processMessages(processFn, messageLimit);
  t.is(result, 1);
  t.is(receiveSpy.calledOnce, true);  
});
