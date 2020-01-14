const pRetry = require('p-retry');
const { isThrottlingException } = require('@cumulus/errors');

const findResourceArn = (obj, fn, prefix, baseName, opts, callback) => {
  obj[fn](opts, (err, data) => {
    if (err) {
      callback(err, data);
      return;
    }

    let arns = null;
    Object.keys(data).forEach((prop) => {
      if (prop.endsWith('Arns')) {
        arns = data[prop];
      }
    });

    if (!arns) {
      callback(`Could not find an 'Arn' property in response from ${fn}`, data);
      return;
    }

    const prefixRe = new RegExp(`^${prefix}-[A-Z0-9]`);
    const baseNameOnly = `-${baseName}-`;
    let matchingArn = null;

    arns.forEach((arn) => {
      const name = arn.split('/').pop();
      if (name.match(prefixRe) && name.includes(baseNameOnly)) {
        matchingArn = arn;
      }
    });

    if (matchingArn) {
      callback(null, matchingArn);
    } else if (data.NextToken) {
      const nextOpts = Object.assign({}, opts, { NextToken: data.NextToken });
      exports.findResourceArn(obj, fn, prefix, baseName, nextOpts, callback);
    } else {
      callback(`Could not find resource ${baseName} in ${fn}`);
    }
  });
};

/**
 * Replace the stack of an error
 *
 * Note: This mutates the error that was passed in.
 *
 * @param {Error} error - an Error
 * @param {string} newStack - a stack trace
 */
const setErrorStack = (error, newStack) => {
  // eslint-disable-next-line no-param-reassign
  error.stack = [
    error.stack.split('\n')[0],
    ...newStack.split('\n').slice(1)
  ].join('\n');
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
 * @param {Function} fn - the function to wrap
 * @returns {Function} a wrapper function
 */
const improveStackTrace = (fn) =>
  async (...args) => {
    const tracerError = {};
    try {
      Error.captureStackTrace(tracerError);
      return await fn(...args);
    } catch (err) {
      setErrorStack(err, tracerError.stack);
      err.message = `${err.message}; Function params: ${JSON.stringify(args, null, 2)}`;
      throw err;
    }
  };

const retryIfThrottlingException = (err) => {
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
 */
const retryOnThrottlingException = (fn, options) =>
  (...args) =>
    pRetry(
      () => fn(...args).catch(retryIfThrottlingException),
      { maxTimeout: 5000, ...options }
    );

module.exports = {
  findResourceArn,
  setErrorStack,
  improveStackTrace,
  retryOnThrottlingException
};
