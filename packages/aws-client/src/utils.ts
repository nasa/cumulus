import pRetry from 'p-retry';
import { isThrottlingException } from '@cumulus/errors';

// Replace the stack of an error
// Note: This mutates the error that was passed in.
export const setErrorStack = (error: Error, newStack: string) => {
  if (error.stack) {
    // eslint-disable-next-line no-param-reassign
    error.stack = [
      error.stack.split('\n')[0],
      ...newStack.split('\n').slice(1)
    ].join('\n');
  } else {
    // eslint-disable-next-line no-param-reassign
    error.stack = newStack;
  }
};

// eslint-disable-next-line valid-jsdoc
/**
 * Wrap a function and provide a better stack trace
 *
 * If a call is made to the aws-sdk and it causes an exception, the stack trace
 * that is returned gives no indication of where the error actually occurred.
 *
 * This utility will wrap a function and, when it is called, update any raised
 * error with a better stack trace.
 *
 * @private
 */
export const improveStackTrace = <T, U extends unknown[]>(fn: (...args: U) => Promise<T>) =>
  async (...args: U) => {
    const tracerError = new Error();
    try {
      Error.captureStackTrace(tracerError);
      return await fn(...args);
    } catch (error) {
      // @ts-ignore
      setErrorStack(error, tracerError.stack);
      error.message = `${error.message}; Function params: ${JSON.stringify(args, undefined, 2)}`;
      throw error;
    }
  };

const retryIfThrottlingException = (err: Error) => {
  if (isThrottlingException(err)) throw err;
  throw new pRetry.AbortError(err);
};

/**
 * Wrap a function so that it will retry when a ThrottlingException is encountered.
 *
 * @param {Function} fn - the function to retry.  This function must return a Promise.
 * @param {Object} options - retry options, documented here:
 *   - https://github.com/sindresorhus/p-retry#options
 *   - https://github.com/tim-kos/node-retry#retryoperationoptions
 *   - https://github.com/tim-kos/node-retry#retrytimeoutsoptions
 * @returns {Function} a function that will retry on a ThrottlingException
 *
 * @private
 */
export const retryOnThrottlingException = <T, U extends unknown[]>(
  fn: (...args: U) => Promise<T>,
  options: pRetry.Options = {}
) =>
    (...args: U) =>
      pRetry(
        () => fn(...args).catch(retryIfThrottlingException),
        { maxTimeout: 5000, ...options }
      );

const retryIfMissingObjectError = (error: Error & { statusCode?: number }) => {
  const { statusCode } = error;

  if (statusCode && [404, 412].includes(statusCode)) throw error;
  throw new pRetry.AbortError(error);
};

/**
 * Returns a function that wraps the specified function, but will retry the
 * wrapped function when it throws a "not found" (404) or "pre-condition failed"
 * (412) error, based upon the specified retry options.
 *
 * @param {Function} fn - function (that returns a Promise) to retry on error
 * @param {Object} options - retry options
 * @returns {Function} a function that will retry the specified function when
 *    it throws a "not found" or "pre-condition failed" error (i.e., the
 *    `statusCode` property of the error is either 404 or 412)
 * @see https://github.com/sindresorhus/p-retry#options
 * @see https://github.com/tim-kos/node-retry#retryoperationoptions
 * @see https://github.com/tim-kos/node-retry#retrytimeoutsoptions
 */
export const retryOnMissingObjectError = <T, U extends unknown[]>(
  fn: (...args: U) => Promise<T>,
  options: pRetry.Options = {}
) =>
    (...args: U) =>
      pRetry(
        () => fn(...args).catch(retryIfMissingObjectError),
        { maxTimeout: 5000, ...options }
      );
