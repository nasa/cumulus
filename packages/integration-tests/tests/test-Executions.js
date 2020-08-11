'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { getExecutionWithStatus } = require('../Executions');

const randomId = (prefix, separator = '-') =>
  `${prefix}${separator}${cryptoRandomString({ length: 6 })}`;

test('getExecutionWithStatus() will retry if the execution does not exist', async (t) => {
  const arn = randomId('arn');
  const prefix = randomId('prefix');

  const callback = (() => {
    let callCount = 0;

    return async () => {
      callCount += 1;

      if (callCount === 1) {
        return {
          body: JSON.stringify({ statusCode: 404 }),
        };
      }

      return {
        body: JSON.stringify({
          statusCode: 200,
          status: 'completed',
        }),
      };
    };
  })();

  await t.notThrowsAsync(
    getExecutionWithStatus({
      prefix,
      arn,
      status: 'completed',
      timeout: 1,
      callback,
    })
  );
});
