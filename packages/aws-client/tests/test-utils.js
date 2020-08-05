const path = require('path');
const test = require('ava');

const { throttleOnce } = require('../test-utils');
const {
  retryOnMissingObjectError,
  retryOnThrottlingException
} = require('../utils');
const { getObject } = require('../S3');
const { s3 } = require('../services');

const throwOnce = (error, fn) => {
  let thrown = false;

  return (...args) => {
    if (!thrown) {
      thrown = true;
      throw error;
    }

    return fn(...args);
  };
};
test('better stack traces', async (t) => {
  const f = () => getObject(s3(), { Bucket: 'asdf', Key: 'jkl;' });
  const g = () => f();
  const h = () => g();

  try {
    await t.throwsAsync(h, { message: /The specified bucket does not exist/ });
  } catch (error) {
    t.true(error.stack.includes(path.basename(__filename)));
  }
});

test('retryOnThrottlingException properly retries after ThrottlingException', async (t) => {
  const asyncSquare = (x) => Promise.resolve(x * x);
  const throttledAsyncSquare = throttleOnce(asyncSquare);
  const throttledAsyncSquareWithRetries = retryOnThrottlingException(throttledAsyncSquare);

  t.is(await throttledAsyncSquareWithRetries(3), 9);
});

test('retryOnMissingObjectError properly retries after 404 Error', async (t) => {
  const asyncSquare = (x) => Promise.resolve(x * x);
  const throwingAsyncSquare = throwOnce(
    Object.assign(new Error(), { statusCode: 404 }),
    asyncSquare
  );
  const throwingAsyncSquareWithRetries = retryOnMissingObjectError(
    throwingAsyncSquare
  );

  t.is(await throwingAsyncSquareWithRetries(3), 9);
});

test('retryOnMissingObjectError properly retries after 412 Error', async (t) => {
  const asyncSquare = (x) => Promise.resolve(x * x);
  const throwingAsyncSquare = throwOnce(
    Object.assign(new Error(), { statusCode: 412 }),
    asyncSquare
  );
  const throwingAsyncSquareWithRetries = retryOnMissingObjectError(
    throwingAsyncSquare
  );

  t.is(await throwingAsyncSquareWithRetries(3), 9);
});
