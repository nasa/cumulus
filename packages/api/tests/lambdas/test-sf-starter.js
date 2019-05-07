'use strict';

const rewire = require('rewire');
const test = require('ava');

const handler = rewire('../../lambdas/sf-starter');
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

test.serial('throws error when queueUrl is undefined', async (t) => {
  const error = await t.throws(handler(ruleInput));
  t.is(error.message, 'queueUrl is missing');
});

test.serial('calls cb with number of messages received', async (t) => {
  ruleInput.queueUrl = 'queue';
  handler.__set__('Consumer', stubConsumer);
  const data = await handler(ruleInput);
  t.is(data, 9);
});
