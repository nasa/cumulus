'use strict';

const test = require('ava');

const deadLettersApi = require('../deadLetters');

test('postDeadLetters call the callback with the expected object when no payload is supplied', async (t) => {
  const expected = {
    prefix: 'deadLettersTest',
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/deadLetters',
      body: undefined,
    },
  };

  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
  };
  await t.notThrowsAsync(deadLettersApi.postDeadLetters({
    prefix: expected.prefix,
    callback,
  }));
});

test('postDeadLetters calls the callback with the expected object', async (t) => {
  const payload = {
    bucket: 'deadLettersTestBucket',
    path: 'deadLettersTestPath',
  };
  const expected = {
    prefix: 'deadLettersTest',
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/deadLetters',
      body: JSON.stringify(payload),
    },
  };

  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
  };
  await t.notThrowsAsync(deadLettersApi.postDeadLetters({
    prefix: expected.prefix,
    payload,
    callback,
  }));
});
