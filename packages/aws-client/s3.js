const fs = require('fs');
const isString = require('lodash.isstring');
const path = require('path');
const pMap = require('p-map');
const pRetry = require('p-retry');
const pump = require('pump');
const url = require('url');

const {
  generateChecksumFromStream,
  validateChecksumFromStream
} = require('@cumulus/checksum');
const {
  InvalidChecksum,
  UnparsableFileLocationError
} = require('@cumulus/errors');
const Logger = require('@cumulus/logger');

const awsServices = require('./services');
const { inTestMode } = require('./test-utils');
const { improveStackTrace } = require('./utils');

const log = new Logger({ sender: 'aws-client/s3' });

let S3_RATE_LIMIT = 20;
if (inTestMode()) {
  S3_RATE_LIMIT = 1;
}

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

/**
* Convert S3 TagSet Object to query string
* e.g. [{ Key: 'tag', Value: 'value }] to 'tag=value'
*
* @param {Array<Object>} tagset - S3 TagSet array
* @returns {string} - tags query string
*/
exports.s3TagSetToQueryString = (tagset) => tagset.reduce((acc, tag) => acc.concat(`&${tag.Key}=${tag.Value}`), '').substring(1);

/**
 * Delete an object from S3
 *
 * @param {string} bucket - bucket where the object exists
 * @param {string} key - key of the object to be deleted
 * @returns {Promise} - promise of the object being deleted
 */
exports.deleteS3Object = improveStackTrace(
  (bucket, key) =>
    awsServices.s3().deleteObject({ Bucket: bucket, Key: key }).promise()
);

/**
 * Test if an object exists in S3
 *
 * @param {Object} params - same params as https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#headObject-property
 * @returns {Promise<boolean>} - a Promise that will resolve to a boolean indicating
 *                               if the object exists
 */
exports.s3ObjectExists = (params) =>
  exports.headObject(params.Bucket, params.Key)
    .then(() => true)
    .catch((e) => {
      if (e.code === 'NotFound') return false;
      throw e;
    });

/**
* Put an object on S3
*
* @param {Object} params - same params as https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObject-property
* @returns {Promise} - promise of the object being put
**/
exports.s3PutObject = improveStackTrace(
  (params) => awsServices.s3().putObject({
    ACL: 'private',
    ...params
  }).promise()
);

/**
* Copy an object from one location on S3 to another
*
* @param {Object} params - same params as https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObject-property
* @returns {Promise} - promise of the object being copied
**/
exports.s3CopyObject = improveStackTrace(
  (params) => awsServices.s3().copyObject({
    TaggingDirective: 'COPY',
    ...params
  }).promise()
);

/**
 * Upload data to S3
 *
 * Note: This is equivalent to calling `aws.s3().upload(params).promise()`
 *
 * @param {Object} params - see [S3.upload()](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property)
 * @returns {Promise} see [S3.upload()](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property)
 */
exports.promiseS3Upload = improveStackTrace(
  (params) => awsServices.s3().upload(params).promise()
);

/**
 * Downloads the given s3Obj to the given filename in a streaming manner
 *
 * @param {Object} s3Obj - The parameters to send to S3 getObject call
 * @param {string} filepath - The filepath of the file that is downloaded
 * @returns {Promise<string>} - returns filename if successful
 */
exports.downloadS3File = (s3Obj, filepath) => {
  const s3 = awsServices.s3();
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
* @param {string} Bucket - name of bucket
* @param {string} Key - key for object (filepath + filename)
* @returns {Promise} - returns response from `S3.headObject` as a promise
**/
exports.headObject = improveStackTrace(
  (Bucket, Key) => awsServices.s3().headObject({ Bucket, Key }).promise()
);

/**
 * Get the size of an S3Object, in bytes
 *
 * @param {string} bucket - S3 bucket
 * @param {string} key - S3 key
 * @returns {Promise<integer>} - object size, in bytes
 */
exports.getObjectSize = (bucket, key) =>
  exports.headObject(bucket, key)
    .then((response) => response.ContentLength);

/**
* Get object Tagging from S3
*
* @param {string} bucket - name of bucket
* @param {string} key - key for object (filepath + filename)
* @returns {Promise} - returns response from `S3.getObjectTagging` as a promise
**/
exports.s3GetObjectTagging = improveStackTrace(
  (bucket, key) =>
    awsServices.s3().getObjectTagging({ Bucket: bucket, Key: key }).promise()
);

/**
* Puts object Tagging in S3
* https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObjectTagging-property
*
* @param {string} Bucket - name of bucket
* @param {string} Key - key for object (filepath + filename)
* @param {Object} Tagging - tagging object
* @returns {Promise} - returns response from `S3.getObjectTagging` as a promise
**/
exports.s3PutObjectTagging = improveStackTrace(
  (Bucket, Key, Tagging) =>
    awsServices.s3().putObjectTagging({
      Bucket,
      Key,
      Tagging
    }).promise()
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
exports.getS3Object = improveStackTrace(
  (Bucket, Key, retryOptions = { retries: 0 }) =>
    pRetry(
      async () => {
        try {
          return await awsServices.s3().getObject({ Bucket, Key }).promise();
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

exports.getJsonS3Object = (bucket, key) =>
  exports.getS3Object(bucket, key)
    .then(({ Body }) => JSON.parse(Body.toString()));

exports.putJsonS3Object = (bucket, key, data) =>
  exports.s3PutObject({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(data)
  });

exports.getS3ObjectReadStream = (bucket, key) => awsServices.s3().getObject(
  { Bucket: bucket, Key: key }
).createReadStream();

/**
* Check if a file exists in an S3 object
*
* @name fileExists
* @param {string} bucket - name of the S3 bucket
* @param {string} key - key of the file in the S3 bucket
* @returns {Promise} returns the response from `S3.headObject` as a promise
**/
exports.fileExists = async (bucket, key) => {
  const s3 = awsServices.s3();

  try {
    const r = await s3.headObject({ Key: key, Bucket: bucket }).promise();
    return r;
  } catch (e) {
    // if file is not return false
    if (e.stack.match(/(NotFound)/) || e.stack.match(/(NoSuchBucket)/)) {
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
  const s3 = awsServices.s3();
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
          log.info(`Progress: [${i} of ${n}] s3://${s3Obj.Bucket}/${s3Obj.Key} -> ${filename}`);
          i += 1;
          return resolve(s3Obj.Key);
        })
        .on('error', reject);
    });
  };

  return pMap(scrubbedS3Objs, promiseDownload, { concurrency: S3_RATE_LIMIT });
};

/**
 * Delete files from S3
 *
 * @param {Array} s3Objs - An array of objects containing keys 'Bucket' and 'Key'
 * @returns {Promise} A promise that resolves to an Array of the data returned
 *   from the deletion operations
 */
exports.deleteS3Files = (s3Objs) => pMap(
  s3Objs,
  (s3Obj) => awsServices.s3().deleteObject(s3Obj).promise(),
  { concurrency: S3_RATE_LIMIT }
);

/**
* Delete a bucket and all of its objects from S3
*
* @param {string} bucket - name of the bucket
* @returns {Promise} - the promised result of `S3.deleteBucket`
**/
exports.recursivelyDeleteS3Bucket = improveStackTrace(
  async (bucket) => {
    const response = await awsServices.s3().listObjects({ Bucket: bucket }).promise();
    const s3Objects = response.Contents.map((o) => ({
      Bucket: bucket,
      Key: o.Key
    }));

    await exports.deleteS3Files(s3Objects);
    await awsServices.s3().deleteBucket({ Bucket: bucket }).promise();
  }
);

exports.uploadS3Files = (files, defaultBucket, keyPath, s3opts = {}) => {
  let i = 0;
  const n = files.length;
  if (n > 1) {
    log.info(`Starting upload of ${n} keys`);
  }
  const promiseUpload = (filenameOrInfo) => {
    let fileInfo = filenameOrInfo;
    if (isString(fileInfo)) {
      const filename = fileInfo;
      fileInfo = {
        key: isString(keyPath)
          ? path.join(keyPath, path.basename(filename))
          : keyPath(filename),
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
        i += 1;
        log.info(`Progress: [${i} of ${n}] ${filename} -> s3://${bucket}/${key}`);
        return { key: key, bucket: bucket };
      });
  };

  return pMap(files, promiseUpload, { concurrency: S3_RATE_LIMIT });
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

  return awsServices.s3().listObjects(params).promise()
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
  let listObjectsResponse = await awsServices.s3().listObjectsV2(params).promise();
  let discoveredObjects = listObjectsResponse.Contents;

  // Keep listing more objects from S3 until we have all of them
  while (listObjectsResponse.IsTruncated) {
    listObjectsResponse = await awsServices.s3().listObjectsV2( // eslint-disable-line no-await-in-loop, max-len
      // Update the params with a Continuation Token
      Object.assign(
        {},
        params,
        { ContinuationToken: listObjectsResponse.NextContinuationToken }
      )
    ).promise();
    discoveredObjects = discoveredObjects.concat(listObjectsResponse.Contents);
  }

  return discoveredObjects;
}
exports.listS3ObjectsV2 = listS3ObjectsV2;

/**
 * Calculate checksum for S3 Object
 *
 * @param {Object} params - params
 * @param {string} params.algorithm - checksum algorithm
 * @param {string} params.bucket - S3 bucket
 * @param {string} params.key - S3 key
 * @param {Object} [params.options] - crypto.createHash options
 *
 * @returns {number|string} - calculated checksum
 */
exports.calculateS3ObjectChecksum = async ({
  algorithm,
  bucket,
  key,
  options
}) => {
  const fileStream = exports.getS3ObjectReadStream(bucket, key);
  return generateChecksumFromStream(algorithm, fileStream, options);
};

/**
 * Validate S3 object checksum against expected sum
 *
 * @param {Object} params - params
 * @param {string} params.algorithm - checksum algorithm
 * @param {string} params.bucket - S3 bucket
 * @param {string} params.key - S3 key
 * @param {number|string} params.expectedSum - expected checksum
 * @param {Object} [params.options] - crypto.createHash options
 *
 * @throws {InvalidChecksum} - Throws error if validation fails
 * @returns {boolean} - returns true for success
 */
exports.validateS3ObjectChecksum = async ({
  algorithm,
  bucket,
  key,
  expectedSum,
  options
}) => {
  const fileStream = exports.getS3ObjectReadStream(bucket, key);
  if (await validateChecksumFromStream(algorithm, fileStream, expectedSum, options)) {
    return true;
  }
  const msg = `Invalid checksum for S3 object s3://${bucket}/${key} with type ${algorithm} and expected sum ${expectedSum}`;
  throw new InvalidChecksum(msg);
};

/**
 * Extract the S3 bucket and key from the URL path parameters
 *
 * @param {string} pathParams - path parameters from the URL
 * @returns {Object} - bucket/key in the form of
 * { Bucket: x, Key: y }
 */
exports.getFileBucketAndKey = (pathParams) => {
  const fields = pathParams.split('/');

  const Bucket = fields.shift();
  const Key = fields.join('/');

  if (Bucket.length === 0 || Key.length === 0) {
    throw new UnparsableFileLocationError(`File location "${pathParams}" could not be parsed`);
  }

  return [Bucket, Key];
};
