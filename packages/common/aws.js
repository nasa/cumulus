/* eslint-disable no-param-reassign */
'use strict';

const AWS = require('aws-sdk');
const concurrency = require('./concurrency');
const fs = require('fs');
const path = require('path');
const url = require('url');
const log = require('./log');
const string = require('./string');
const { inTestMode, randomString, testAwsClient } = require('./test-utils');
const promiseRetry = require('promise-retry');

const region = exports.region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
if (region) {
  AWS.config.update({ region: region });
}

// Workaround upload hangs. See: https://github.com/andrewrk/node-s3-client/issues/74'
AWS.util.update(AWS.S3.prototype, { addExpect100Continue: function addExpect100Continue() {} });
AWS.config.setPromisesDependency(Promise);

const S3_RATE_LIMIT = 20;

const memoize = (fn) => {
  let memo = null;
  return () => {
    if (!memo) memo = fn();
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
    return memoize(() => testAwsClient(Service, options));
  }
  return memoize(() => new Service(options));
};

exports.ecs = awsClient(AWS.ECS, '2014-11-13');
exports.s3 = awsClient(AWS.S3, '2006-03-01');
exports.lambda = awsClient(AWS.Lambda, '2015-03-31');
exports.sqs = awsClient(AWS.SQS, '2012-11-05');
exports.cloudwatchevents = awsClient(AWS.CloudWatchEvents, '2014-02-03');
exports.cloudwatchlogs = awsClient(AWS.CloudWatchLogs, '2014-03-28');
exports.dynamodb = awsClient(AWS.DynamoDB, '2012-08-10');
exports.dynamodbstreams = awsClient(AWS.DynamoDBStreams, '2012-08-10');
exports.dynamodbDocClient = awsClient(AWS.DynamoDB.DocumentClient, '2012-08-10');
exports.sfn = awsClient(AWS.StepFunctions, '2016-11-23');
exports.cf = awsClient(AWS.CloudFormation, '2010-05-15');
exports.sns = awsClient(AWS.SNS, '2010-03-31');

/**
 * Describes the resources belonging to a given CloudFormation stack
 *
 * See https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CloudFormation.html#describeStackResources-property
 *
 * @param {string} stackName The name of the CloudFormation stack to query
 * @return {Array<Object>} The resources belonging to the stack
 */
exports.describeCfStackResources = (stackName) =>
  exports.cf().describeStackResources({ StackName: stackName })
    .promise()
    .then((response) => response.StackResources);

exports.findResourceArn = (obj, fn, prefix, baseName, opts, callback) => {
  obj[fn](opts, (err, data) => {
    if (err) {
      callback(err, data);
      return;
    }

    let arns = null;
    for (const prop of Object.keys(data)) {
      if (prop.endsWith('Arns')) {
        arns = data[prop];
      }
    }
    if (!arns) {
      callback(`Could not find an 'Arn' property in response from ${fn}`, data);
      return;
    }

    const prefixRe = new RegExp(`^${prefix}-[A-Z0-9]`);
    const baseNameOnly = `-${baseName}-`;
    let matchingArn = null;
    for (const arn of arns) {
      const name = arn.split('/').pop();
      if (name.match(prefixRe) && name.indexOf(baseNameOnly) !== -1) {
        matchingArn = arn;
      }
    }
    if (matchingArn) {
      callback(null, matchingArn);
    }
    else if (data.NextToken) {
      const nextOpts = Object.assign({}, opts, { NextToken: data.NextToken });
      exports.findResourceArn(obj, fn, prefix, baseName, nextOpts, callback);
    }
    else {
      callback(`Could not find resource ${baseName} in ${fn}`);
    }
  });
};

/**
 * Delete an object from S3
 *
 * @param {string} bucket
 * @param {string} key
 * @returns {Promise}
 */
exports.deleteS3Object = (bucket, key) =>
  exports.s3().deleteObject({ Bucket: bucket, Key: key }).promise();

/**
 * Test if an object exists in S3
 *
 * @param {Object} params - same params as https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#headObject-property
 * @returns {Promise<boolean>} - a Promise that will resolve to a boolean indicating
 *                               if the object exists
 */
exports.s3ObjectExists = (params) =>
  exports.s3().headObject(params).promise()
    .then(() => true)
    .catch((e) => {
      if (e.code === 'NotFound') return false;
      throw e;
    });

exports.promiseS3Upload = (params) => {
  const uploadFn = exports.s3().upload.bind(exports.s3());
  return concurrency.toPromise(uploadFn, params);
};

/**
 * Downloads the given s3Obj to the given filename in a streaming manner
 * @param s3Obj The parameters to send to S3 getObject call
 * @param filename The output filename
 */
exports.downloadS3File = (s3Obj, filename) => {
  const s3 = exports.s3();
  const file = fs.createWriteStream(filename);
  return new Promise((resolve, reject) => {
    s3.getObject(s3Obj)
      .createReadStream()
      .pipe(file)
      .on('finish', () => resolve(filename))
      .on('error', reject);
  });
};

/**
* Get an object from S3
*
* @param {string} bucket - name of bucket
* @param {string} key - key for object (filepath + filename)
* @returns {Promise} - returns response from `S3.getObject` as a promise
**/
exports.getS3Object = (bucket, key) =>
  exports.s3().getObject({ Bucket: bucket, Key: key }).promise();

/**
* Check if a file exists in an S3 object
* @name fileExists
* @param {string} bucket name of the S3 bucket
* @param {string} key key of the file in the S3 bucket
* @returns {promise} returns the response from `S3.headObject` as a promise
**/
exports.fileExists = async (bucket, key) => {
  const s3 = exports.s3();

  try {
    const r = await s3.headObject({ Key: key, Bucket: bucket }).promise();
    return r;
  }
  catch (e) {
    // if file is not return false
    if (e.stack.match(/(NotFound)/)) {
      return false;
    }
    throw e;
  }
};


exports.downloadS3Files = (s3Objs, dir, s3opts = {}) => {
  // Scrub s3Ojbs to avoid errors from the AWS SDK
  const scrubbedS3Objs = s3Objs.map((s3Obj) => ({
    Bucket: s3Obj.Bucket,
    Key: s3Obj.Key
  }));
  const s3 = exports.s3();
  let i = 0;
  const n = s3Objs.length;
  log.info(`Starting download of ${n} keys to ${dir}`);
  const promiseDownload = (s3Obj) => {
    const filename = path.join(dir, path.basename(s3Obj.Key));
    const file = fs.createWriteStream(filename);
    const opts = Object.assign(s3Obj, s3opts);
    return new Promise((resolve, reject) => {
      s3.getObject(opts)
        .createReadStream()
        .pipe(file)
        .on('finish', () => {
          log.info(`Progress: [${i++} of ${n}] s3://${s3Obj.Bucket}/${s3Obj.Key} -> ${filename}`);
          return resolve(s3Obj.Key);
        })
        .on('error', reject);
    });
  };
  const limitedDownload = concurrency.limit(S3_RATE_LIMIT, promiseDownload);
  return Promise.all(scrubbedS3Objs.map(limitedDownload));
};

/**
 * Delete files from S3
 * @param {Array} s3Objs An array of objects containing keys 'Bucket' and 'Key'
 * @param {Object} s3Opts An optional object containing options that influence the behavior of S3
 * @return A promise that resolves to an Array of the data returned from the deletion operations
 */
exports.deleteS3Files = (s3Objs) => {
  log.info(`Starting deletion of ${s3Objs.length} object(s)`);

  const promiseDelete = (s3Obj) => exports.s3().deleteObject(s3Obj).promise();
  const limitedDelete = concurrency.limit(S3_RATE_LIMIT, promiseDelete);

  return Promise.all(s3Objs.map(limitedDelete));
};

/**
* Delete a bucket and all of its objects from S3
*
* @param {string} bucket - name of the bucket
* @returns {Promise} - the promised result of `S3.deleteBucket`
**/
exports.recursivelyDeleteS3Bucket = async (bucket) => {
  const response = await exports.s3().listObjects({ Bucket: bucket }).promise();
  const s3Objects = response.Contents.map((o) => ({
    Bucket: bucket,
    Key: o.Key
  }));

  await exports.deleteS3Files(s3Objects);
  await exports.s3().deleteBucket({ Bucket: bucket }).promise();
};

exports.uploadS3Files = (files, defaultBucket, keyPath, s3opts = {}) => {
  let i = 0;
  const n = files.length;
  if (n > 1) {
    log.info(`Starting upload of ${n} keys`);
  }
  const promiseUpload = (filenameOrInfo) => {
    let fileInfo = filenameOrInfo;
    if (typeof fileInfo === 'string') {
      const filename = fileInfo;
      fileInfo = {
        key: (typeof keyPath === 'string') ?
          path.join(keyPath, path.basename(filename)) :
          keyPath(filename),
        filename: filename
      };
    }
    const bucket = fileInfo.bucket || defaultBucket;
    const filename = fileInfo.filename;
    const key = fileInfo.key;
    const body = fs.createReadStream(filename);
    const opts = Object.assign({ Bucket: bucket, Key: key, Body: body }, s3opts);
    return exports.promiseS3Upload(opts)
      .then(() => {
        log.info(`Progress: [${++i} of ${n}] ${filename} -> s3://${bucket}/${key}`);
        return { key: key, bucket: bucket };
      });
  };
  const limitedUpload = concurrency.limit(S3_RATE_LIMIT, promiseUpload);
  return Promise.all(files.map(limitedUpload));
};

/**
 * Upload the file associated with the given stream to an S3 bucket
 * @param {ReadableStream} fileStream The stream for the file's contents
 * @param {string} bucket The S3 bucket to which the file is to be uploaded
 * @param {string} key The key to the file in the bucket
 * @param s3opts {Object} Options to pass to the AWS sdk call (defaults to `{}`)
 * @return A promise
 */
exports.uploadS3FileStream = (fileStream, bucket, key, s3opts = {}) => {
  const opts = Object.assign({ Bucket: bucket, Key: key, Body: fileStream }, s3opts);
  return exports.promiseS3Upload(opts);
};

/**
 * List the objects in an S3 bucket
 *
 * @param {string} bucket - The name of the bucket
 * @param {string} prefix - Only objects with keys starting with this prefix
 *   will be included (useful for searching folders in buckets, e.g., '/PDR')
 * @param {boolean} skipFolders - If true don't return objects that are folders
 *   (defaults to true)
 * @returns {Promise} - A promise that resolves to the list of objects. Each S3
 *   object is represented as a JS object with the following attributes: `Key`,
 * `ETag`, `LastModified`, `Owner`, `Size`, `StorageClass`.
 */
exports.listS3Objects = (bucket, prefix = null, skipFolders = true) => {
  log.info(`Listing objects in s3://${bucket}`);
  const params = {
    Bucket: bucket
  };
  if (prefix) params.Prefix = prefix;

  return exports.s3().listObjects(params).promise()
    .then((data) => {
      let contents = data.Contents || [];
      if (skipFolders) {
        // Filter out any references to folders
        contents = contents.filter((obj) => !obj.Key.endsWith('/'));
      }

      return contents;
    });
};

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
 * @returns {Promise.<Array>} - resolves to an array of objects corresponding to
 *   the Contents property of the listObjectsV2 response
 */
async function listS3ObjectsV2(params) {
  const data = await exports.s3().listObjectsV2(params).promise();

  if (data.IsTruncated) {
    const newParams = Object.assign({}, params);
    newParams.ContinuationToken = data.NextContinuationToken;
    return data.Contents.concat(await exports.listS3ObjectsV2(newParams));
  }

  return data.Contents;
}
exports.listS3ObjectsV2 = listS3ObjectsV2;

exports.syncUrl = async (uri, bucket, destKey) => {
  const response = await concurrency.promiseUrl(uri);
  await exports.promiseS3Upload({ Bucket: bucket, Key: destKey, Body: response });
};

exports.getQueueUrl = (sourceArn, queueName) => {
  const arnParts = sourceArn.split(':');
  return `https://sqs.${arnParts[3]}.amazonaws.com/${arnParts[4]}/${queueName}`;
};

/**
* parse an s3 uri to get the bucket and key
* @param {string} uri must be a uri with the `s3://` protocol
* @return {object} Returns an object with `Bucket` and `Key` properties
**/
exports.parseS3Uri = (uri) => {
  const parsedUri = url.parse(uri);

  if (parsedUri.protocol !== 's3:') {
    throw new Error('uri must be a S3 uri, e.g. s3://bucketname');
  }

  return {
    Bucket: parsedUri.hostname,
    Key: parsedUri.path.substring(1)
  };
};

exports.getPossiblyRemote = async (obj) => {
  if (obj && obj.Key && obj.Bucket) {
    const s3Obj = await exports.s3().getObject(obj).promise();
    return s3Obj.Body.toString();
  }
  return obj;
};

exports.startPromisedSfnExecution = (params) =>
  exports.sfn().startExecution(params).promise();

const getCurrentSfnTaskWithoutRetry = async (stateMachineArn, executionName) => {
  const sfn = exports.sfn();
  const executionArn = exports.getSfnExecutionByName(stateMachineArn, executionName);
  const executionHistory = await sfn.getExecutionHistory({
    executionArn: executionArn,
    maxResults: 10,
    reverseOrder: true
  }).promise();
  for (const step of executionHistory.events) {
    // Avoid iterating past states that have ended
    if (step.type.endsWith('StateExited')) break;
    if (step.type === 'TaskStateEntered') return step.stateEnteredEventDetails.name;
  }
  throw new Error(`No task found for ${stateMachineArn}#${executionName}`);
};

exports.getCurrentSfnTask = (stateMachineArn, executionName) =>
  promiseRetry(
    async (retry) => {
      try {
        const task = await getCurrentSfnTaskWithoutRetry(stateMachineArn, executionName);
        log.info('Successfully fetched current task.');
        return task;
      }
      catch (e) {
        if (e.name === 'ThrottlingException') {
          log.info('Got a throttling exception in aws.getCurrentSfnTask()');
          return retry();
        }
        throw e;
      }
    },
    {
      factor: 1.5,
      maxTimeout: 10000,
      randomize: true
    }
  );

/**
 * Given an array of fields, returns that a new string that's safe for use as a StepFunction,
 * execution name, where all fields are joined by a StepFunction-safe delimiter
 * Important: This transformation isn't entirely two-way. Names longer than 80 characters
 *            will be truncated.
 *
 * @param{string} fields - The fields to be injected into an execution name
 * @param{string} delimiter - An optional delimiter string to replace, pass null to make
 *   no replacements
 * @return - A string that's safe to use as a StepFunctions execution name
 */
exports.toSfnExecutionName = (fields, delimiter = '__') => {
  let sfnUnsafeChars = '[^\\w-=+_.]';
  if (delimiter) {
    sfnUnsafeChars = `(${delimiter}|${sfnUnsafeChars})`;
  }
  const regex = new RegExp(sfnUnsafeChars, 'g');
  return fields.map((s) => s.replace(regex, string.unicodeEscape).replace(/\\/g, '!'))
    .join(delimiter)
    .substring(0, 80);
};

/**
 * Opposite of toSfnExecutionName. Given a delimited StepFunction execution name, returns
 * an array of its original fields
 * Important: This value may be truncated from the original because of the 80-char limit on
 *            execution names
 *
 * @param{string} str - The string to make stepfunction safe
 * @param{string} delimiter - An optional delimiter string to replace, pass null to make
 *   no replacements
 * @param{string} sfnDelimiter - The string to replace delimiter with
 * @return - An array of the original fields
 */
exports.fromSfnExecutionName = (str, delimiter = '__') =>
  str.split(delimiter)
    .map((s) => s.replace(/!/g, '\\').replace('"', '\\"'))
    .map((s) => JSON.parse(`"${s}"`));

/**
 * Create an SQS Queue.  Properly handles localstack queue URLs
 *
 * @param {string} queueName - defaults to a random string
 * @returns {Promise.<string>} the Queue URL
 */
async function createQueue(queueName) {
  const actualQueueName = queueName || randomString();

  const createQueueResponse = await exports.sqs().createQueue({
    QueueName: actualQueueName
  }).promise();

  if (inTestMode()) {
    // Properly set the Queue URL.  This is needed because LocalStack always
    // returns the QueueUrl as "localhost", even if that is not where it should
    // actually be found.  CircleCI breaks without this.
    const returnedQueueUrl = url.parse(createQueueResponse.QueueUrl);
    returnedQueueUrl.host = undefined;
    returnedQueueUrl.hostname = process.env.LOCALSTACK_HOST;

    return url.format(returnedQueueUrl);
  }

  return createQueueResponse.QueueUrl;
}
exports.createQueue = createQueue;

/**
* Send a message to AWS SQS
*
* @param {string} queueUrl - url of the SQS queue
* @param {string|Object} message - either string or object message. If an
*   object it will be serialized into a JSON string.
* @returns {Promise} - resolves when the messsage has been sent
**/
exports.sendSQSMessage = (queueUrl, message) => {
  let messageBody;
  if (typeof message === 'string') messageBody = message;
  else if (typeof message === 'object') messageBody = JSON.stringify(message);
  else throw new Error('body type is not accepted');

  return exports.sqs().sendMessage({
    MessageBody: messageBody,
    QueueUrl: queueUrl
  }).promise();
};

/**
 * Receives SQS messages from a given queue. The number of messages received
 * can be set and the timeout is also adjustable.
 *
 * @param {string} queueUrl - url of the SQS queue
 * @param {integer} numOfMessages - number of messages to read from the queue
 * @param {integer} timeout - number of seconds it takes for a message to timeout
 * @returns {Promise.<Array>} an array of messages
 */
exports.receiveSQSMessages = async (queueUrl, numOfMessages = 1, timeout = 30) => {
  const params = {
    QueueUrl: queueUrl,
    AttributeNames: ['All'],
    VisibilityTimeout: timeout,
    MaxNumberOfMessages: numOfMessages
  };

  const messages = await exports.sqs().receiveMessage(params).promise();

  // convert body from string to js object
  if (Object.prototype.hasOwnProperty.call(messages, 'Messages')) {
    messages.Messages.forEach((mes) => {
      mes.Body = JSON.parse(mes.Body); // eslint-disable-line no-param-reassign
    });

    return messages.Messages;
  }
  return [];
};

/**
 * Delete a given SQS message from a given queue.
 *
 * @param {string} queueUrl - url of the SQS queue
 * @param {integer} receiptHandle - the unique identifier of the sQS message
 * @returns {Promise} an AWS SQS response
 */
exports.deleteSQSMessage = (queueUrl, receiptHandle) => {
  const params = {
    QueueUrl: queueUrl,
    ReceiptHandle: receiptHandle
  };

  return exports.sqs().deleteMessage(params).promise();
};

/**
 * Returns execution ARN from a statement machine Arn and executionName
 *
 * @param {string} stateMachineArn state machine ARN
 * @param {string} executionName state machine's execution name
 * @returns {string} Step Function Execution Arn
 */
exports.getExecutionArn = (stateMachineArn, executionName) => {
  if (stateMachineArn && executionName) {
    const sfArn = stateMachineArn.replace('stateMachine', 'execution');
    return `${sfArn}:${executionName}`;
  }
  return null;
};

/**
* Parse event metadata to get location of granule on S3
*
* @param {string} granuleId - the granule id
* @param {string} stack = the deployment stackname
* @param {string} bucket - the deployment bucket name
* @returns {string} - s3 path
**/
exports.getGranuleS3Params = (granuleId, stack, bucket) => {
  return `${stack}/granules_ingested/${granuleId}`;
};

/**
* Set the status of a granule
*
* @name setGranuleStatus
* @param {string} granuleId - granule id
* @param {string} stack - the deployment stackname
* @param {string} bucket - the deployment bucket name
* @param {string} stateMachineArn - statemachine arn
* @param {string} executionName - execution name
* @param {string} status - granule status
* @returns {Promise} returns the response from `S3.put` as a promise
**/
exports.setGranuleStatus = async (
  granuleId,
  stack,
  bucket,
  stateMachineArn,
  executionName,
  status
) => {
  const key = exports.getGranuleS3Params(granuleId, stack, bucket);
  const executionArn = exports.getExecutionArn(stateMachineArn, executionName);
  const params = { Bucket: bucket, Key: key };
  params.Metadata = { executionArn, status };
  await exports.s3().putObject(params).promise();
};
