'use strict';

const rewire = require('rewire');
const test = require('ava');

const sfStarter = rewire('../../lambdas/sf-starter');
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

test.serial('throws error when queueUrl is undefined', (t) => {
  const errCb = (err, _data) => t.is(err.message, 'queueUrl is missing');
  sfStarter.handler(ruleInput, {}, errCb);
});

test.serial('calls cb with number of messages received', async (t) => {
  ruleInput.queueUrl = 'queue';
  sfStarter.__set__('Consumer', stubConsumer);
  const cb = (_err, data) => t.is(data, 9);
  sfStarter.handler(ruleInput, {}, cb);
});
