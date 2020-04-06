'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const {
  getQueueName,
  getQueueNameByUrl,
  getMaximumExecutions,
  hasQueueAndExecutionLimit
} = require('../Queue');

const randomId = (prefix) => `${prefix}${cryptoRandomString({ length: 10 })}`;

test('getQueueName returns correct queue name', (t) => {
  const queueName = randomId('queue');
  const message = {
    cumulus_meta: {
      queueName
    }
  };
  t.is(getQueueName(message), queueName);
});

test('getQueueName throws error if cumulus_meta.queueName is not set in message', (t) => {
  const message = {
    cumulus_meta: {}
  };
  t.throws(() => getQueueName(message));
});

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

test('hasQueueAndExecutionLimit returns true if queue name and execution limit exist in message', (t) => {
  const queueName = randomId('queue');
  const message = {
    cumulus_meta: {
      queueName
    },
    meta: {
      queueExecutionLimits: {
        [queueName]: 5
      }
    }
  };
  t.true(hasQueueAndExecutionLimit(message));
});

test('hasQueueAndExecutionLimit returns false if queue name does not exist in message', (t) => {
  const queueName = randomId('queue');
  const message = {
    cumulus_meta: {},
    meta: {
      queueExecutionLimits: {
        [queueName]: 5
      }
    }
  };
  t.false(hasQueueAndExecutionLimit(message));
});

test('hasQueueAndExecutionLimit returns false if execution limit does not exist in message', (t) => {
  const queueName = randomId('queue');
  const message = {
    cumulus_meta: {
      queueName
    },
    meta: {
      queueExecutionLimits: {}
    }
  };
  t.false(hasQueueAndExecutionLimit(message));
});
