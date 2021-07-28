'use strict';

const test = require('ava');

const replaysApi = require('../replays');

test('postKinesisReplays calls the callback with the expected object', async (t) => {
  const payload = {
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
    expectedStatusCode: 202,
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
