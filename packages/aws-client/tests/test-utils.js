const path = require('path');
const test = require('ava');
const { throttleOnce } = require('@cumulus/common/test-utils');

const { retryOnThrottlingException } = require('../utils');
const { getS3Object } = require('../S3');

test('better stack traces', async (t) => {
  const f = () => getS3Object('asdf');
  const g = () => f();
  const h = () => g();

  try {
    console.log(await h());
    t.fail('Expected an exception');
  } catch (err) {
    t.true(err.stack.includes(path.basename(__filename)));
  }
});

test('retryOnThrottlingException() properly retries after ThrottlingExceptions', async (t) => {
  const asyncSquare = (x) => Promise.resolve(x * x);

  const throttledAsyncSquare = throttleOnce(asyncSquare);

  const throttledAsyncSquareWithRetries = retryOnThrottlingException(throttledAsyncSquare);

  t.is(
    await throttledAsyncSquareWithRetries(3),
    9
  );
});
