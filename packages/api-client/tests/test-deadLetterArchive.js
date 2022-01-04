'use strict';

const test = require('ava');

const deadLetterArchiveApi = require('../deadLetterArchive');

test('postRecoverCumulusMessages call the callback with the expected object when no payload is supplied', async (t) => {
  const expected = {
    prefix: 'deadLetterArchiveTest',
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/deadLetterArchive/recoverCumulusMessages',
      body: undefined,
    },
    expectedStatusCodes: 202,
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };
  await t.notThrowsAsync(deadLetterArchiveApi.postRecoverCumulusMessages({
    prefix: expected.prefix,
    callback,
  }));
});

test('postRecoverCumulusMessages calls the callback with the expected object', async (t) => {
  const payload = {
    bucket: 'deadLetterArchiveTestBucket',
    path: 'deadLetterArchiveTestPath',
  };
  const expected = {
    prefix: 'deadLetterArchiveTest',
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/deadLetterArchive/recoverCumulusMessages',
      body: JSON.stringify(payload),
    },
    expectedStatusCodes: 202,
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };
  await t.notThrowsAsync(deadLetterArchiveApi.postRecoverCumulusMessages({
    prefix: expected.prefix,
    payload,
    callback,
  }));
});
