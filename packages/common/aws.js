'use strict';

const AWS = require('aws-sdk');
const concurrency = require('./concurrency');
const errors = require('./errors');
const fs = require('fs');
const path = require('path');
const url = require('url');
const log = require('./log');
const string = require('./string');
const { inTestMode, randomString, testAwsClient } = require('./test-utils');
const promiseRetry = require('promise-retry');
const pump = require('pump');

/**
 * Join strings into an S3 key without a leading slash or double slashes
 *
 * @param {...string|Array<string>} args - the strings to join
 * @returns {string} the full S3 key
 */
function s3Join(...args) {
  const tokens = Array.isArray(args[0]) ? args[0] : args;

  const removeLeadingSlash = (token) => token.replace(/^\//, '');
  const removeTrailingSlash = (token) => token.replace(/\/$/, '');
  const isNotEmptyString = (token) => token.length > 0;

  const key = tokens
    .map(removeLeadingSlash)
    .map(removeTrailingSlash)
    .filter(isNotEmptyString)
    .join('/');

  if (tokens[tokens.length - 1].endsWith('/')) return `${key}/`;
  return key;
}
exports.s3Join = s3Join;

exports.region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
AWS.config.update({ region: exports.region });

// Workaround upload hangs. See: https://github.com/andrewrk/node-s3-client/issues/74'
AWS.util.update(AWS.S3.prototype, { addExpect100Continue: function addExpect100Continue() {} });
AWS.config.setPromisesDependency(Promise);


let S3_RATE_LIMIT = 20;
if (inTestMode()) {
  S3_RATE_LIMIT = 1;
}

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
exports.kms = awsClient(AWS.KMS);

/**
 * Create a DynamoDB table and then wait for the table to exist
 *
 * @param {Object} params - the same params that you would pass to AWS.createTable
 *   See https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB.html#createTable-property
 * @returns {Promise<Object>} - the output of the createTable call
 */
async function createAndWaitForDynamoDbTable(params) {
  const createTableResult = await exports.dynamodb().createTable(params).promise();
  await exports.dynamodb().waitFor('tableExists', { TableName: params.TableName }).promise();

  return createTableResult;
}
exports.createAndWaitForDynamoDbTable = createAndWaitForDynamoDbTable;

/**
 * Describes the resources belonging to a given CloudFormation stack
 *
 * See https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CloudFormation.html#describeStackResources-property
 *
 * @param {string} stackName -  The name of the CloudFormation stack to query
 * @returns {Array<Object>} The resources belonging to the stack
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
 * @param {string} bucket - bucket where the object exists
 * @param {string} key - key of the object to be deleted
 * @returns {Promise} - promise of the object being deleted
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
 *
 * @param {Object} s3Obj - The parameters to send to S3 getObject call
 * @param {string} filepath - The filepath of the file that is downloaded
 * @returns {Promise<string>} - returns filename if successful
 */
exports.downloadS3File = (s3Obj, filepath) => {
  const s3 = exports.s3();
  const fileWriteStream = fs.createWriteStream(filepath);

  return new Promise((resolve, reject) => {
    const objectReadStream = s3.getObject(s3Obj).createReadStream();

    pump(objectReadStream, fileWriteStream, (err) => {
      if (err) reject(err);
      else resolve(filepath);
    });
  });
};


/**
* Get an object header from S3
*
* @param {string} bucket - name of bucket
* @param {string} key - key for object (filepath + filename)
* @returns {Promise} - returns response from `S3.headObject` as a promise
**/

exports.headObject = (bucket, key) =>
  exports.s3().headObject({ Bucket: bucket, Key: key }).promise();

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
*
* @name fileExists
* @param {string} bucket - name of the S3 bucket
* @param {string} key - key of the file in the S3 bucket
* @returns {Promise} returns the response from `S3.headObject` as a promise
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
 *
 * @param {Array} s3Objs - An array of objects containing keys 'Bucket' and 'Key'
 * @param {Object} s3Opts - An optional object containing options that influence the behavior of S3
 * @returns {Promise} A promise that resolves to an Array of the data returned
 *                    from the deletion operations
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
 *
 * @param {ReadableStream} fileStream - The stream for the file's contents
 * @param {string} bucket - The S3 bucket to which the file is to be uploaded
 * @param {string} key - The key to the file in the bucket
 * @param {Object} s3opts - Options to pass to the AWS sdk call (defaults to `{}`)
 * @returns {Promise} A promise
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
 * @returns {Promise<Array>} - resolves to an array of objects corresponding to
 *   the Contents property of the listObjectsV2 response
 */
async function listS3ObjectsV2(params) {
  // Fetch the first list of objects from S3
  let listObjectsResponse = await exports.s3().listObjectsV2(params).promise();
  let discoveredObjects = listObjectsResponse.Contents;

  // Keep listing more objects from S3 until we have all of them
  while (listObjectsResponse.IsTruncated) {
    listObjectsResponse = await exports.s3().listObjectsV2( // eslint-disable-line no-await-in-loop, function-paren-newline, max-len
      // Update the params with a Continuation Token
      Object.assign(
        {},
        params,
        { ContinuationToken: listObjectsResponse.NextContinuationToken }
      )
    ).promise(); //eslint-disable-line function-paren-newline
    discoveredObjects = discoveredObjects.concat(listObjectsResponse.Contents);
  }

  return discoveredObjects;
}
exports.listS3ObjectsV2 = listS3ObjectsV2;

// Class to efficiently list all of the objects in an S3 bucket, without loading
// them all into memory at once.  Handles paging of listS3ObjectsV2 requests.
class S3ListObjectsV2Queue {
  constructor(params) {
    this.items = [];
    this.params = params;
    this.s3 = exports.s3();
  }

  /**
   * View the next item in the queue
   *
   * This does not remove the object from the queue.  When there are no more
   * items in the queue, returns 'null'.
   *
   * @returns {Promise<Object>} - an S3 object description
   */
  async peek() {
    if (this.items.length === 0) await this.fetchItems();
    return this.items[0];
  }

  /**
   * Remove the next item from the queue
   *
   * When there are no more items in the queue, returns 'null'.
   *
   * @returns {Promise<Object>} - an S3 object description
   */
  async shift() {
    if (this.items.length === 0) await this.fetchItems();
    return this.items.shift();
  }

  /**
   * Query the S3 API to get the next 1,000 items
   *
   * @returns {Promise<undefined>} - resolves when the queue has been updated
   * @private
   */
  async fetchItems() {
    const response = await this.s3.listObjectsV2(this.params).promise();

    this.items = response.Contents;

    if (response.IsTruncated) {
      this.params.ContinuationToken = response.NextContinuationToken;
    }
    else this.items.push(null);
  }
}
exports.S3ListObjectsV2Queue = S3ListObjectsV2Queue;

// Class to efficiently scane all of the items in a DynamoDB table, without
// loading them all into memory at once.  Handles paging.
class DynamoDbScanQueue {
  constructor(params) {
    this.items = [];
    this.params = params;
    this.dynamodb = exports.dynamodb();
  }

  /**
   * View the next item in the queue
   *
   * This does not remove the object from the queue.  When there are no more
   * items in the queue, returns 'null'.
   *
   * @returns {Promise<Object>} - an item from the DynamoDB table
   */
  async peek() {
    if (this.items.length === 0) await this.fetchItems();
    return this.items[0];
  }

  /**
   * Remove the next item from the queue
   *
   * When there are no more items in the queue, returns 'null'.
   *
   * @returns {Promise<Object>} - an item from the DynamoDB table
   */
  async shift() {
    if (this.items.length === 0) await this.fetchItems();
    return this.items.shift();
  }

  /**
   * Query the DynamoDB API to get the next batch of items
   *
   * @returns {Promise<undefined>} - resolves when the queue has been updated
   * @private
   */
  async fetchItems() {
    let response;
    do {
      response = await this.dynamodb.scan(this.params).promise(); // eslint-disable-line no-await-in-loop, max-len
      if (response.LastEvaluatedKey) this.params.ExclusiveStartKey = response.LastEvaluatedKey;
    } while (response.Items.length === 0 && response.LastEvaluatedKey);

    this.items = response.Items;

    if (!response.LastEvaluatedKey) this.items.push(null);
  }
}
exports.DynamoDbScanQueue = DynamoDbScanQueue;

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
*
* @param {string} uri - must be a uri with the `s3://` protocol
* @returns {Object} Returns an object with `Bucket` and `Key` properties
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

/**
 * Given a bucket and key, return an S3 URI
 *
 * @param {string} bucket - an S3 bucket name
 * @param {string} key - an S3 key
 * @returns {string} - an S3 URI
 */
exports.buildS3Uri = (bucket, key) => `s3://${bucket}/${key.replace(/^\/+/, '')}`;

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
 * @param {string} fields - The fields to be injected into an execution name
 * @param {string} delimiter - An optional delimiter string to replace, pass null to make
 *   no replacements
 * @returns {string} - A string that's safe to use as a StepFunctions execution name
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
 * @param {string} str - The string to make stepfunction safe
 * @param {string} delimiter - An optional delimiter string to replace, pass null to make
 *   no replacements
 * @param {string} sfnDelimiter - The string to replace delimiter with
 * @returns {Array} - An array of the original fields
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
 * @param {string} stateMachineArn - state machine ARN
 * @param {string} executionName - state machine's execution name
 * @returns {string} - Step Function Execution Arn
 */
exports.getExecutionArn = (stateMachineArn, executionName) => {
  if (stateMachineArn && executionName) {
    const sfArn = stateMachineArn.replace('stateMachine', 'execution');
    return `${sfArn}:${executionName}`;
  }
  return null;
};

const getSfnExecution = async (arn, ignoreMissingExecutions = false) => {
  const sfn = exports.sfn();

  const params = {
    executionArn: arn
  };

  try {
    const r = await sfn.describeExecution(params).promise();
    return r;
  }
  catch (e) {
    if (ignoreMissingExecutions && e.message && e.message.includes('Execution Does Not Exist')) {
      return {
        executionArn: arn,
        status: 'NOT_FOUND'
      };
    }
    throw e;
  }
};

/**
 * Stop a step function execution
 *
 * @param {string} executionArn - executionArn
 * @param {string} cause - cause for stopping
 * @param {string} error - error
 * @returns {Promise} - response from `StepFunctions.stopExecution` as a promise
 */
exports.stopExecution = async (executionArn, cause, error) => {
  const sfn = exports.sfn();
  return sfn.stopExecution({
    executionArn: executionArn,
    cause: cause,
    error: error
  }).promise();
};

/**
 * Fetch an event from S3
 *
 * @param {Object} event - an event to be fetched from S3
 * @param {string} event.s3_path - the S3 location of the event
 * @returns {Promise.<Object>} - the parsed event from S3
 */
exports.pullSfnEvent = async (event) => {
  if (event.s3_path) {
    const parsed = exports.parseS3Uri(event.s3_path);
    const file = await exports.getS3Object(parsed.Bucket, parsed.Key);

    return JSON.parse(file.Body.toString());
  }
  return event;
};

/**
 * Get execution status from a state machine executionArn
 *
 * @param {string} executionArn - execution ARN
 * @returns {Object} - Object with { execution, executionHistory, stateMachine }
 */
exports.getSfnExecutionStatusFromArn = async (executionArn) => {
  const sfn = exports.sfn();
  const [execution, executionHistory] = await Promise.all([
    getSfnExecution(executionArn),
    sfn.getExecutionHistory({
      executionArn: executionArn,
      maxResults: 10,
      reverseOrder: true
    }).promise()
  ]);

  const stateMachine = await sfn.describeStateMachine({
    stateMachineArn: execution.stateMachineArn
  }).promise();

  return { execution, executionHistory, stateMachine };
};

/**
 * Returns execution ARN from a state machine Arn and executionName
 *
 * @param {string} executionArn - execution ARN
 * @returns {string} - aws console url for the execution
 */
exports.getExecutionUrl = (executionArn) => {
  const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
  return `https://console.aws.com/states/home?region=${region}` +
         `#/executions/details/${executionArn}`;
};

/**
* Parse event metadata to get location of granule on S3
*
* @param {string} granuleId - the granule id
* @param {string} stack - the deployment stackname
* @param {string} bucket - the deployment bucket name
* @returns {string} - s3 path
**/
exports.getGranuleS3Params = (granuleId, stack, bucket) =>
  `${stack}/granules_ingested/${granuleId}`;

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

/**
 * Invoke a lambda
 *
 * @param {string} name - name of the lambda to invoke
 * @param {Object} payload - JSON Object to be passed into the lambda
 * @param {string} type - Invocation Type of the lamdba
 * @returns {Promise} - response from `lambda.invoke()` as a promise
 */
exports.invokeLambda = async (name, payload, type = 'Event') => {
  if (process.env.IS_LOCAL || inTestMode()) {
    log.info(`Faking Lambda invocation for ${name}`);
    return false;
  }

  const lambda = exports.lambda();

  const params = {
    FunctionName: name,
    Payload: JSON.stringify(payload),
    InvocationType: type
  };

  log.info(`invoked ${name}`);
  return lambda.invoke(params).promise();
};

/**
 * Create a ClouwdWatch event from parameters
 *
 * @param {string} name - Name of the event to create
 * @param {string} schedule - scedule expression
 * @param {string} state - 'EDNABLED' | 'DISABLED'
 * @param {string} description - description of the rule
 * @param {string} role - roleArn (optional)
 * @returns {Promise} - response from `CloudWatchEvents.putEvents` as a promise
 */
exports.putCloudWatchEvent = async (name, schedule, state, description = null, role = null) => {
  const cwevents = exports.cloudwatchevents();

  const params = {
    Name: name,
    Description: description,
    RoleArn: role,
    ScheduleExpression: schedule,
    State: state
  };

  return cwevents.putRule(params).promise();
};

/**
 * Create a CloudWatch Target from parameters
 *
 * @param {string} rule - target rule
 * @param {string} id - Id of the target to be created
 * @param {string} arn - ARN of the target to be created
 * @param {string} input - Input of the target to be created
 * @returns {Promise} - response from `CloudWatchEvents.putTargets` as a promise
 */
exports.putCloudWatchTarget = async (rule, id, arn, input) => {
  const cwevents = exports.cloudwatchevents();

  const params = {
    Rule: rule,
    Targets: [ /* required */
      {
        Arn: arn,
        Id: id,
        Input: input
      }
    ]
  };

  return cwevents.putTargets(params).promise();
};

/**
 * Delete a CloudWatch Event based on name
 *
 * @param {string} name - Name of the CW Event to delete
 * @returns {Promise} - response from `CloudWatchEvents.deleteRule` as a promise
 */
exports.deleteCloudWatchEvent = async (name) => {
  const cwevents = exports.cloudwatchevents();

  const params = {
    Name: name
  };

  return cwevents.deleteRule(params).promise();
};

/**
 * Delete a CloudWatch Target based on params
 *
 * @param {string} id - Id of the target to delete
 * @param {string} rule - Name of the rule to delete
 * @returns {Promise} - response from `CloudWatchEvents.removeTargets` as a promise
 */
exports.deleteCloudWatchTarget = async (id, rule) => {
  const cwevents = exports.cloudwatchevents();

  const params = {
    Ids: [id],
    Rule: rule
  };

  return cwevents.removeTargets(params).promise();
};

const KMSDecryptionFailed = errors.createErrorType('KMSDecryptionFailed');

class KMS {
  static async encrypt(text, kmsId) {
    const params = {
      KeyId: kmsId,
      Plaintext: text
    };

    const kms = exports.kms();
    const r = await kms.encrypt(params).promise();
    return r.CiphertextBlob.toString('base64');
  }

  static async decrypt(text) {
    const params = {
      CiphertextBlob: new Buffer(text, 'base64')
    };
    const kms = exports.kms();
    try {
      const r = await kms.decrypt(params).promise();
      return r.Plaintext.toString();
    }
    catch (e) {
      if (e.toString().includes('InvalidCiphertextException')) {
        throw new KMSDecryptionFailed(
          'Decrypting the secure text failed. The provided text is invalid'
        );
      }
      throw e;
    }
  }
}

exports.KMS = KMS;
