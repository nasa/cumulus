'use strict';

const test = require('ava');

const replaySqsMessagesApi = require('../replaySqsMessages');

test('replaySqsMessages calls the callback with the expected object and returns the parsed response', async (t) => {
  const prefix = 'unitTestStack';
  const queueName = 'myQueue';
  const payload = {
    queueName,
    type: 'sqs',
  };

  const expected = {
    prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/replaySqsMessages',
      body: JSON.stringify(payload),
    },
    expectedStatusCode: 202,
  };
  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };

  await t.notThrowsAsync(replaySqsMessagesApi.replaySqsMessages({
    prefix,
    payload,
    callback,
  }));
});
