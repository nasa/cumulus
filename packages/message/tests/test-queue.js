'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { getQueueNameByUrl, getMaximumExecutions } = require('../queue');

const randomId = (prefix) => `${prefix}${cryptoRandomString({ length: 10 })}`;

test('getQueueNameByUrl returns correct value', (t) => {
  const queueName = randomId('queueName');
  const queueUrl = randomId('queueUrl');
  const testMessage = {
    meta: {
      queues: {
        [queueName]: queueUrl
      }
    }
  };

  let queueNameResult = getQueueNameByUrl(testMessage, queueUrl);
  t.is(queueNameResult, queueName);

  queueNameResult = getQueueNameByUrl(testMessage, 'fake-value');
  t.is(queueNameResult, undefined);

  queueNameResult = getQueueNameByUrl({}, 'queueUrl');
  t.is(queueNameResult, undefined);
});

test('getMaximumExecutions returns correct value', (t) => {
  const queueName = randomId('queueName');
  const testMessage = {
    meta: {
      queueExecutionLimits: {
        [queueName]: 5
      }
    }
  };
  const maxExecutions = getMaximumExecutions(testMessage, queueName);
  t.is(maxExecutions, 5);
});

test('getMaximumExecutions throw error when queue cannot be found', (t) => {
  const testMessage = {
    meta: {
      queueExecutionLimits: {}
    }
  };
  t.throws(
    () => getMaximumExecutions(testMessage, 'testQueueName')
  );
});
