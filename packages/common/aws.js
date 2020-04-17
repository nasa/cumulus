'use strict';

const AWS = require('aws-sdk');
const pMap = require('p-map');
const pRetry = require('p-retry');
const url = require('url');

const errors = require('@cumulus/errors');
const Logger = require('@cumulus/logger');

const { inTestMode, testAwsClient } = require('./test-utils');
const { deprecate, setErrorStack } = require('./util');

const log = new Logger({ sender: 'common/aws' });
const noop = () => {}; // eslint-disable-line lodash/prefer-noop

let S3_RATE_LIMIT = 20;
if (inTestMode()) {
  S3_RATE_LIMIT = 1;
}

exports.region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
AWS.config.update({ region: exports.region });

// Workaround upload hangs. See: https://github.com/andrewrk/node-s3-client/issues/74'
AWS.util.update(AWS.S3.prototype, { addExpect100Continue: noop });
AWS.config.setPromisesDependency(Promise);

const memoize = (fn) => {
  let memo = null;
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
const awsClient = (Service, version = null) => {
  const options = {};
  if (version) options.apiVersion = version;

  if (inTestMode()) {
    if (AWS.DynamoDB.DocumentClient.serviceIdentifier === undefined) {
      AWS.DynamoDB.DocumentClient.serviceIdentifier = 'dynamodb';
    }
    return memoize((o) => testAwsClient(Service, Object.assign(options, o)));
  }
  return memoize((o) => new Service(Object.assign(options, o)));
};

exports.s3 = (options) => {
  deprecate('@cumulus/common/aws/s3', '1.17.0', '@cumulus/aws-client/services/s3');
  return awsClient(AWS.S3, '2006-03-01')(options);
};
exports.cloudwatchlogs = (options) => {
  deprecate('@cumulus/common/aws/cloudwatchlogs', '1.17.0', '@cumulus/aws-client/services/cloudwatchlogs');
  return awsClient(AWS.CloudWatchLogs, '2014-03-28')(options);
};
exports.dynamodb = (options) => {
  deprecate('@cumulus/common/aws/dynamodb', '1.17.0', '@cumulus/aws-client/services/dynamodb');
  return awsClient(AWS.DynamoDB, '2012-08-10')(options);
};
exports.dynamodbDocClient = (options) => {
  deprecate('@cumulus/common/aws/dynamodbDocClient', '1.17.0', '@cumulus/aws-client/services/dynamodbDocClient');
  return awsClient(AWS.DynamoDB.DocumentClient, '2012-08-10')(options);
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
exports.improveStackTrace = (fn) =>
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

/* S3 utils */

/**
 * Test if an object exists in S3
 *
 * @param {Object} params - same params as https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#headObject-property
 * @returns {Promise<boolean>} - a Promise that will resolve to a boolean indicating
 *                               if the object exists
 */
exports.s3ObjectExists = (params) => {
  deprecate('@cumulus/common/aws/s3ObjectExists', '1.17.0', '@cumulus/aws-client/S3/s3ObjectExists');
  return exports.headObject(params.Bucket, params.Key)
    .then(() => true)
    .catch((e) => {
      if (e.code === 'NotFound') return false;
      throw e;
    });
};

/**
* Put an object on S3
*
* @param {Object} params - same params as https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObject-property
* @returns {Promise} - promise of the object being put
**/
exports.s3PutObject = exports.improveStackTrace(
  (params) => {
    deprecate('@cumulus/common/aws/s3PutObject', '1.17.0', '@cumulus/aws-client/S3/s3PutObject');
    return exports.s3().putObject({
      ACL: 'private',
      ...params
    }).promise();
  }
);

/**
* Copy an object from one location on S3 to another
*
* @param {Object} params - same params as https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObject-property
* @returns {Promise} - promise of the object being copied
**/
exports.s3CopyObject = exports.improveStackTrace(
  (params) => {
    deprecate('@cumulus/common/aws/s3CopyObject', '1.17.0', '@cumulus/aws-client/S3/s3CopyObject');
    return exports.s3().copyObject({
      TaggingDirective: 'COPY',
      ...params
    }).promise();
  }
);

/**
 * Upload data to S3
 *
 * Note: This is equivalent to calling `aws.s3().upload(params).promise()`
 *
 * @param {Object} params - see [S3.upload()](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property)
 * @returns {Promise} see [S3.upload()](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property)
 */
exports.promiseS3Upload = exports.improveStackTrace(
  (params) => {
    deprecate('@cumulus/common/aws/promiseS3Upload', '1.17.0', '@cumulus/aws-client/S3/promiseS3Upload');
    return exports.s3().upload(params).promise();
  }
);

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
exports.getS3Object = exports.improveStackTrace(
  (Bucket, Key, retryOptions = { retries: 0 }) =>
    pRetry(
      async () => {
        deprecate('@cumulus/common/aws/getS3Object', '1.17.0', '@cumulus/aws-client/S3/getS3Object');
        try {
          return await exports.s3().getObject({ Bucket, Key }).promise();
        } catch (err) {
          if (err.code === 'NoSuchKey') throw err;
          throw new pRetry.AbortError(err);
        }
      },
      {
        maxTimeout: 10000,
        onFailedAttempt: (err) => log.debug(`getS3Object('${Bucket}', '${Key}') failed with ${err.retriesLeft} retries left: ${err.message}`),
        ...retryOptions
      }
    )
);

/**
* Get an object header from S3
*
* @param {string} Bucket - name of bucket
* @param {string} Key - key for object (filepath + filename)
* @returns {Promise} - returns response from `S3.headObject` as a promise
**/
exports.headObject = exports.improveStackTrace(
  (Bucket, Key) => {
    deprecate('@cumulus/common/aws/headObject', '1.17.0', '@cumulus/aws-client/S3/headObject');
    return exports.s3().headObject({ Bucket, Key }).promise();
  }
);

/**
 * Delete an object from S3
 *
 * @param {string} bucket - bucket where the object exists
 * @param {string} key - key of the object to be deleted
 * @returns {Promise} - promise of the object being deleted
 */
exports.deleteS3Object = exports.improveStackTrace(
  (bucket, key) => {
    deprecate('@cumulus/common/aws/deleteS3Object', '1.17.0', '@cumulus/aws-client/S3/deleteS3Object');
    return exports.s3().deleteObject({ Bucket: bucket, Key: key }).promise();
  }
);

/**
 * Delete files from S3
 *
 * @param {Array} s3Objs - An array of objects containing keys 'Bucket' and 'Key'
 * @returns {Promise} A promise that resolves to an Array of the data returned
 *   from the deletion operations
 */
exports.deleteS3Files = (s3Objs) => {
  deprecate('@cumulus/common/aws/deleteS3Files', '1.17.0', '@cumulus/aws-client/S3/deleteS3Files');
  return pMap(
    s3Objs,
    (s3Obj) => exports.s3().deleteObject(s3Obj).promise(),
    { concurrency: S3_RATE_LIMIT }
  );
};

/**
* Delete a bucket and all of its objects from S3
*
* @param {string} bucket - name of the bucket
* @returns {Promise} - the promised result of `S3.deleteBucket`
**/
exports.recursivelyDeleteS3Bucket = exports.improveStackTrace(
  async (bucket) => {
    deprecate('@cumulus/common/aws/recursivelyDeleteS3Bucket', '1.17.0', '@cumulus/aws-client/S3/recursivelyDeleteS3Bucket');
    const response = await exports.s3().listObjects({ Bucket: bucket }).promise();
    const s3Objects = response.Contents.map((o) => ({
      Bucket: bucket,
      Key: o.Key
    }));

    await exports.deleteS3Files(s3Objects);
    await exports.s3().deleteBucket({ Bucket: bucket }).promise();
  }
);

/**
 * Fetch complete list of S3 objects
 *
 * listObjectsV2 is limited to 1,000 results per call.  This function continues
 * listing objects until there are no more to be fetched.
 *
 * The passed params must be compatible with the listObjectsV2 call.
 *
 * https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#listObjectsV2-property
 *
 * @param {Object} params - params for the s3.listObjectsV2 call
 * @returns {Promise<Array>} - resolves to an array of objects corresponding to
 *   the Contents property of the listObjectsV2 response
 */
exports.listS3ObjectsV2 = async (params) => {
  deprecate('@cumulus/common/aws/listS3ObjectsV2', '1.17.0', '@cumulus/aws-client/S3/listS3ObjectsV2');
  // Fetch the first list of objects from S3
  let listObjectsResponse = await exports.s3().listObjectsV2(params).promise();
  let discoveredObjects = listObjectsResponse.Contents;

  // Keep listing more objects from S3 until we have all of them
  while (listObjectsResponse.IsTruncated) {
    listObjectsResponse = await exports.s3().listObjectsV2( // eslint-disable-line no-await-in-loop, max-len
      // Update the params with a Continuation Token
      {

        ...params,
        ContinuationToken: listObjectsResponse.NextContinuationToken
      }
    ).promise();
    discoveredObjects = discoveredObjects.concat(listObjectsResponse.Contents);
  }

  return discoveredObjects;
};

/**
* parse an s3 uri to get the bucket and key
*
* @param {string} uri - must be a uri with the `s3://` protocol
* @returns {Object} Returns an object with `Bucket` and `Key` properties
**/
exports.parseS3Uri = (uri) => {
  deprecate('@cumulus/common/aws/parseS3Uri', '1.17.0', '@cumulus/aws-client/S3/parseS3Uri');
  const parsedUri = url.parse(uri);

  if (parsedUri.protocol !== 's3:') {
    throw new Error('uri must be a S3 uri, e.g. s3://bucketname');
  }

  return {
    Bucket: parsedUri.hostname,
    Key: parsedUri.path.substring(1)
  };
};

/**
 * Returns execution ARN from a statement machine Arn and executionName
 *
 * @param {string} stateMachineArn - state machine ARN
 * @param {string} executionName - state machine's execution name
 * @returns {string} - Step Function Execution Arn
 */
exports.getExecutionArn = (stateMachineArn, executionName) => {
  deprecate('@cumulus/common/aws/getExecutionArn', '1.17.0', '@cumulus/aws-client/StepFunctions/getExecutionArn');
  if (stateMachineArn && executionName) {
    const sfArn = stateMachineArn.replace('stateMachine', 'execution');
    return `${sfArn}:${executionName}`;
  }
  return null;
};

/** General utils */

const retryIfThrottlingException = (err) => {
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
exports.retryOnThrottlingException = (fn, options) =>
  (...args) =>
    pRetry(
      () => fn(...args).catch(retryIfThrottlingException),
      { maxTimeout: 5000, ...options }
    );
