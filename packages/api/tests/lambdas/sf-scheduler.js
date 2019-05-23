'use strict';

const rewire = require('rewire');
const test = require('ava');

const schedule = rewire('../../lambdas/sf-scheduler');
class stubConsumer {
  async consume() {
    return 9;
  }
}

const ruleInput = {
  queueUrl: undefined,
  messageLimit: 50,
  timeLimit: 60
};
const queueName = 'dont talk to me';
const scheduleInput = {
  queueName
}

test.serial('Sends a message to SQS with queueName if queueName is defined', (t) => {
});

test.serial('Sends a message to SQS with startSF if queueName is not defined', (t) => {
});

test.serial('throws error when queueUrl is undefined', (t) => {
  const errCb = (err, _data) => t.is(err.message, 'queueUrl is missing');
  handler(ruleInput, {}, errCb);
});

test.serial('calls cb with number of messages received', async (t) => {
  ruleInput.queueUrl = 'queue';
  handler.__set__('Consumer', stubConsumer);
  const cb = (_err, data) => t.is(data, 9);
  handler(ruleInput, {}, cb);
});