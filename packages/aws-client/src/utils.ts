import pRetry = require('p-retry');
import { isThrottlingException } from '@cumulus/errors';

/**
 * Replace the stack of an error
 *
 * Note: This mutates the error that was passed in.
 *
 * @param error - an Error
 * @param newStack - a stack trace
 */
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

/**
 * Wrap a function and provide a better stack trace
 *
 * If a call is made to the aws-sdk and it causes an exception, the stack trace
 * that is returned gives no indication of where the error actually occurred.
 *
 * This utility will wrap a function and, when it is called, update any raised
 * error with a better stack trace.
 *
 * @param fn - the function to wrap
 * @returns a wrapper function
 */
export const improveStackTrace = <T, U extends unknown[]>(fn: (...args: U) => Promise<T>) =>
  async (...args: U) => {
    const tracerError = new Error();
    try {
      Error.captureStackTrace(tracerError);
      return await fn(...args);
    } catch (err) {
      // @ts-ignore
      setErrorStack(err, tracerError.stack);
      err.message = `${err.message}; Function params: ${JSON.stringify(args, null, 2)}`;
      throw err;
    }
  };

const retryIfThrottlingException = (err: Error) => {
  if (isThrottlingException(err)) throw err;
  throw new pRetry.AbortError(err);
};

/**
 * Wrap a function so that it will retry when a ThrottlingException is encountered.
 *
 * @param fn - the function to retry.  This function must return a Promise.
 * @param options - retry options, documented here:
 *   - https://github.com/sindresorhus/p-retry#options
 *   - https://github.com/tim-kos/node-retry#retryoperationoptions
 *   - https://github.com/tim-kos/node-retry#retrytimeoutsoptions
 * @returns a function that will retry on a ThrottlingException
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
