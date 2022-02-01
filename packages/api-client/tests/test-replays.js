'use strict';

const test = require('ava');

const replaysApi = require('../replays');

test('postKinesisReplays calls the callback with the expected object', async (t) => {
  const payload = {
    type: 'kinesis',
    kinesisStream: 'fake-stream',
    endTimestamp: Date.now(),
    startTimestamp: Date.now(),
  };
  const expected = {
    prefix: 'replaysPrefix',
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/replays',
      body: JSON.stringify(payload),
    },
    expectedStatusCodes: 202,
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };
  await t.notThrowsAsync(replaysApi.postKinesisReplays({
    prefix: expected.prefix,
    payload,
    callback,
  }));
});

test('replaySqsMessages calls the callback with the expected object and returns the parsed response', async (t) => {
  const prefix = 'unitTestStack';
  const queueName = 'myQueue';
  const payload = {
    queueName,
  };

  const expected = {
    prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/replays/sqs',
      body: JSON.stringify(payload),
    },
    expectedStatusCodes: 202,
  };
  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };

  await t.notThrowsAsync(replaysApi.replaySqsMessages({
    prefix,
    payload,
    callback,
  }));
});
