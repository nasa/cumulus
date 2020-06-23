import AWS from 'aws-sdk';
import pRetry from 'p-retry';
import errors from '@cumulus/errors';
import Logger from '@cumulus/logger';
import { inTestMode, testAwsClient } from './test-utils';
import { deprecate } from './util';

const noop = () => { }; // eslint-disable-line lodash/prefer-noop

const log = new Logger({ sender: 'common/aws' });

export const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
AWS.config.update({ region });

// Workaround upload hangs. See: https://github.com/andrewrk/node-s3-client/issues/74'
// @ts-expect-error
AWS.util.update(AWS.S3.prototype, { addExpect100Continue: noop });
AWS.config.setPromisesDependency(Promise);

// @ts-expect-error
const memoize = (fn) => {
  let memo: unknown;
  // @ts-expect-error
  return (options) => {
    if (!memo) memo = fn(options);
    return memo;
  };
};

/**
 * Return a function which, when called, will return an AWS service object
 *
 * Note: The returned service objects are cached, so there will only be one
 *       instance of each service object per process.
 *
 * @param {Function} Service - an AWS service object constructor function
 * @param {string} version - the API version to use
 * @returns {Function} - a function which, when called, will return an AWS service object
 */
// @ts-expect-error
const awsClient = (Service, version) => {
  const options = {};
  // @ts-expect-error
  if (version) options.apiVersion = version;

  if (inTestMode()) {
    // @ts-expect-error
    if (AWS.DynamoDB.DocumentClient.serviceIdentifier === undefined) {
      // @ts-expect-error
      AWS.DynamoDB.DocumentClient.serviceIdentifier = 'dynamodb';
    }
    // @ts-expect-error
    return memoize((o) => testAwsClient(Service, Object.assign(options, o)));
  }
  // @ts-expect-error
  return memoize((o) => new Service(Object.assign(options, o)));
};

export const s3 = (options?: unknown): AWS.S3 => {
  deprecate('@cumulus/common/aws/s3', '1.17.0', '@cumulus/aws-client/services/s3');
  // @ts-expect-error
  return awsClient(AWS.S3, '2006-03-01')(options);
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
// @ts-expect-error
export const improveStackTrace = (fn) =>
// @ts-expect-error
  async (...args) => {
    const tracerError = {};
    try {
      Error.captureStackTrace(tracerError);
      return await fn(...args);
    } catch (error) {
      error.message = `${error.message}; Function params: ${JSON.stringify(args, undefined, 2)}`;
      throw error;
    }
  };

/**
* Get an object from S3
*
* @param {string} Bucket - name of bucket
* @param {string} Key - key for object (filepath + filename)
* @param {Object} retryOptions - options to control retry behavior when an
*   object does not exist. See https://github.com/tim-kos/node-retry#retryoperationoptions
*   By default, retries will not be performed
* @returns {Promise} - returns response from `S3.getObject` as a promise
**/
export const getS3Object = improveStackTrace(
  (Bucket: string, Key: string, retryOptions = { retries: 0 }) =>
    pRetry(
      async () => {
        deprecate('@cumulus/common/aws/getS3Object', '1.17.0', '@cumulus/aws-client/S3/getS3Object');
        try {
          return await s3().getObject({ Bucket, Key }).promise();
        } catch (error) {
          if (error.code === 'NoSuchKey') throw error;
          throw new pRetry.AbortError(error);
        }
      },
      {
        maxTimeout: 10000,
        onFailedAttempt: (err) => log.debug(`getS3Object('${Bucket}', '${Key}') failed with ${err.retriesLeft} retries left: ${err.message}`),
        ...retryOptions
      }
    )
);
/** General utils */

const retryIfThrottlingException = (err: Error) => {
  if (errors.isThrottlingException(err)) throw err;
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
// @ts-expect-error
export const retryOnThrottlingException = (fn, options) =>
  // @ts-expect-error
  (...args) =>
    pRetry(
      () => fn(...args).catch(retryIfThrottlingException),
      { maxTimeout: 5000, ...options }
    );
