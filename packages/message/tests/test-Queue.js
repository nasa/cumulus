'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const {
  getQueueUrl,
  getMaximumExecutions,
  hasQueueAndExecutionLimit,
} = require('../Queue');

const randomId = (prefix) => `${prefix}${cryptoRandomString({ length: 10 })}`;

test('getQueueUrl returns correct queue URL', (t) => {
  const queueUrl = randomId('queue');
  const message = {
    cumulus_meta: {
      queueUrl,
    },
  };
  t.is(getQueueUrl(message), queueUrl);
});

test('getQueueUrl throws error if queue URL cannot be found', (t) => {
  const message = {
    cumulus_meta: {},
  };
  t.throws(() => getQueueUrl(message));
});

test('getMaximumExecutions returns correct value', (t) => {
  const queueUrl = randomId('queueUrl');
  const testMessage = {
    cumulus_meta: {
      queueExecutionLimits: {
        [queueUrl]: 5,
      },
    },
  };
  const maxExecutions = getMaximumExecutions(testMessage, queueUrl);
  t.is(maxExecutions, 5);
});

test('getMaximumExecutions throws an error when queue cannot be found in message', (t) => {
  const testMessage = {
    cumulus_meta: {
      queueExecutionLimits: {},
    },
  };
  t.throws(
    () => getMaximumExecutions(testMessage, 'testQueueName')
  );
});

test('hasQueueAndExecutionLimit returns true if queue name and execution limit exist in message', (t) => {
  const queueUrl = randomId('queue');
  const message = {
    cumulus_meta: {
      queueUrl,
      queueExecutionLimits: {
        [queueUrl]: 5,
      },
    },
  };
  t.true(hasQueueAndExecutionLimit(message));
});

test('hasQueueAndExecutionLimit returns false if queue URL does not exist in message', (t) => {
  const queueUrl = randomId('queue');
  const message = {
    cumulus_meta: {
      queueExecutionLimits: {
        [queueUrl]: 5,
      },
    },
  };
  t.false(hasQueueAndExecutionLimit(message));
});

test('hasQueueAndExecutionLimit returns false if execution limit does not exist in message', (t) => {
  const queueUrl = randomId('queue');
  const message = {
    cumulus_meta: {
      queueUrl,
      queueExecutionLimits: {},
    },
  };
  t.false(hasQueueAndExecutionLimit(message));
});
