const fs = require('fs');
const isString = require('lodash/isString');
const path = require('path');
const pMap = require('p-map');
const pRetry = require('p-retry');
const pump = require('pump');
const range = require('lodash/range');
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
 * Upload a file to S3
 *
 * @param {string} bucket - the destination S3 bucket
 * @param {string} key - the destination S3 key
 * @param {filename} filename - the local file to be uploaded
 * @returns {Promise}
 */
exports.putFile = (bucket, key, filename) =>
  exports.s3PutObject({
    Bucket: bucket,
    Key: key,
    Body: fs.createReadStream(filename)
  });

/**
 * Copy an object from one location on S3 to another.  If copying fails because
 * the object exceeds the size limit of `S3.copyObject`, a copy is attempted
 * via `s3UploadCopy`, which handles large files via multipart upload.  By
 * default, tags are copied from the source object to the target object, but
 * this can be overridden by setting the `TaggingDirective` property in the
 * specified parameters to something other than `"COPY"` (such as `"REPLACE"`,
 * `null`, or `undefined`).
 *
 * @param {Object} params - same params as `S3.copyObject`
 * @returns {Promise} - promise of the object being copied
 * @see s3UploadCopy
 * @see {@link https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#copyObject-property|S3.copyObject}
 * @see {@link https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property|S3.upload}
 */
exports.s3CopyObject = improveStackTrace((params) => {
  const paramsWithTaggingDirective = { TaggingDirective: 'COPY', ...params };

  return awsServices
    .s3()
    .copyObject(paramsWithTaggingDirective)
    .promise()
    .catch(() => exports.s3UploadCopy(paramsWithTaggingDirective));
});

/**
 * Copy an arbitrarily large object from one location on S3 to another.  By
 * default, tags are copied from the source object to the target object, but
 * this can be overridden by setting the `TaggingDirective` property in the
 * specified parameters to something other than `"COPY"` (such as `"REPLACE"`,
 * `null`, or `undefined`).
 *
 * @param {Object} params - same params as `S3.copyObject`
 * @returns {Promise} - promise of the object being copied
 * @see {@link https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#copyObject-property|S3.copyObject}
 * @see {@link https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property|S3.upload}
 */
exports.s3UploadCopy = improveStackTrace(async (params) => {
  // IMPLEMENTATION NOTE: Using S3.upload keeps things simple because it
  // handles all the details of a multipart upload.  However, it might not
  // perform as well as using S3.uploadPartCopy.
  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#uploadPartCopy-property

  const paramsWithTaggingDirective = { TaggingDirective: 'COPY', ...params };
  const { TaggingDirective } = paramsWithTaggingDirective;
  const [srcBucket, srcKey] = exports.getFileBucketAndKey(params.CopySource);
  const srcStream = exports.getS3ObjectReadStream(srcBucket, srcKey);
  const uploadParams = { ...paramsWithTaggingDirective, Body: srcStream };
  // This only applies to S3.copyObject, so remove it for S3.upload
  delete uploadParams.CopySource;

  if (TaggingDirective === 'COPY') {
    const tagging = await exports.s3GetObjectTagging(srcBucket, srcKey);
    uploadParams.Tagging = exports.encodeTags(tagging.TagSet);
  }

  return exports.promiseS3Upload(uploadParams);
});

/**
 * Returns a encoded URL Query parameter string of the form `Key=Value`, where
 * `Key` and `Value` are the values of those properties of the specified tag.
 *
 * @param {Object} tag - the tag to be encoded
 * @param {string} tag.Key - the tag's key
 * @param {string} tag.Value - the tag's value
 * @returns {string} encoded URL Query parameter string of the form `Key=Value`
 */
const encodeTag = ({ Key, Value }) =>
  [encodeURIComponent(Key), encodeURIComponent(Value)].join('=');

/**
 * Returns a string encoded as URL Query parameters constructed from the
 * specified tags, appropriate for the value of a `Tagging` parameter for
 * various S3 methods.
 *
 * @param {Array<Object>} tags - array of tags, where each tag is an object
 *    with a `Key` and `Value` property
 * @returns {string} encoded URL Query parameter string constructed from the
 *    specified tags of the form `key1=value1&key2=value2&...`, where each
 *    key and value is obtained from the `Key` and `Value` properties of each
 *    tag
 */
exports.encodeTags = (tags) => tags.map(encodeTag).join('&');

/**
 * Returns a promise of the access control list (ACL) of an object. To use this
 * operation, you must have READ_ACP access to the object.
 *
 * @param {Object} params - same params as AWS.S3.getObjectAcl, where `Bucket`
 *    and `Key` are required properties
 * @returns {Promise} a promise of the access control list (ACL) of the
 *    specified object
 * @see {@link https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#getObjectAcl-property|AWS.S3.getObjectAcl}
 */
exports.getObjectAcl = improveStackTrace(
  (params) => awsServices.s3().getObjectAcl(params).promise()
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
  const fileWriteStream = fs.createWriteStream(filepath);

  return new Promise((resolve, reject) => {
    const objectReadStream = awsServices.s3().getObject(s3Obj).createReadStream();

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
* @param {Object} retryOptions - options to control retry behavior when an
*   object does not exist. See https://github.com/tim-kos/node-retry#retryoperationoptions
*   By default, retries will not be performed
* @returns {Promise} - returns response from `S3.headObject` as a promise
**/
exports.headObject = improveStackTrace(
  (Bucket, Key, retryOptions = { retries: 0 }) =>
    pRetry(
      async () => {
        try {
          return await awsServices.s3().headObject({ Bucket, Key }).promise();
        } catch (err) {
          if (err.code === 'NotFound') throw err;
          throw new pRetry.AbortError(err);
        }
      },
      { maxTimeout: 10000, ...retryOptions }
    )
);

/**
 * Get the size of an S3Object, in bytes
 *
 * @param {string} bucket - S3 bucket
 * @param {string} key - S3 key
 * @returns {Promise<integer>} - object size, in bytes
 */
exports.getObjectSize = (bucket, key) =>
  exports.headObject(bucket, key, { retries: 3 })
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

/**
 * Fetch the contents of an S3 object
 *
 * @param {string} bucket - the S3 object's bucket
 * @param {string} key - the S3 object's key
 * @returns {Promise<string>} the contents of the S3 object
 */
exports.getTextObject = (bucket, key) =>
  exports.getS3Object(bucket, key)
    .then(({ Body }) => Body.toString());

/**
 * Fetch JSON stored in an S3 object
 * @param {string} bucket - the S3 object's bucket
 * @param {string} key - the S3 object's key
 * @returns {Promise<*>} the contents of the S3 object, parsed as JSON
 */
exports.getJsonS3Object = (bucket, key) =>
  exports.getTextObject(bucket, key)
    .then(JSON.parse);

exports.putJsonS3Object = (bucket, key, data) =>
  exports.s3PutObject({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(data)
  });

/**
 * Get a readable stream for an S3 object.
 *
 * @param {string} bucket - the S3 object's bucket
 * @param {string} key - the S3 object's key
 * @returns {ReadableStream}
 * @throws {Error} if S3 object cannot be found
 */
exports.getS3ObjectReadStream = (bucket, key) => awsServices.s3().getObject(
  { Bucket: bucket, Key: key }
).createReadStream();

/**
 * Get a readable stream for an S3 object.
 *
 * Use `getS3Object()` before fetching stream to deal
 * with eventual consistency issues by checking for object
 * with retries.
 *
 * @param {string} bucket - the S3 object's bucket
 * @param {string} key - the S3 object's key
 * @returns {ReadableStream}
 * @throws {Error} if S3 object cannot be found
 */
exports.getS3ObjectReadStreamAsync = (bucket, key) =>
  exports.getS3Object(bucket, key, { retries: 3 })
    .then(() => exports.getS3ObjectReadStream(bucket, key));

/**
* Check if a file exists in an S3 object
*
* @name fileExists
* @param {string} bucket - name of the S3 bucket
* @param {string} key - key of the file in the S3 bucket
* @returns {Promise} returns the response from `S3.headObject` as a promise
**/
exports.fileExists = async (bucket, key) => {
  try {
    const r = await awsServices.s3().headObject({ Key: key, Bucket: bucket }).promise();
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

  let i = 0;
  const n = s3Objs.length;
  log.info(`Starting download of ${n} keys to ${dir}`);
  const promiseDownload = (s3Obj) => {
    const filename = path.join(dir, path.basename(s3Obj.Key));
    const file = fs.createWriteStream(filename);
    const opts = Object.assign(s3Obj, s3opts);
    return new Promise((resolve, reject) => {
      awsServices.s3().getObject(opts)
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
    const opts = {
      Bucket: bucket, Key: key, Body: body, ...s3opts
    };
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
  const opts = {
    Bucket: bucket, Key: key, Body: fileStream, ...s3opts
  };
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
      {
        ...params,
        ContinuationToken: listObjectsResponse.NextContinuationToken
      }
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
  const fileStream = await exports.getS3ObjectReadStreamAsync(bucket, key);
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
  const fileStream = await exports.getS3ObjectReadStreamAsync(bucket, key);
  if (await validateChecksumFromStream(algorithm, fileStream, expectedSum, options)) {
    return true;
  }
  const msg = `Invalid checksum for S3 object s3://${bucket}/${key} with type ${algorithm} and expected sum ${expectedSum}`;
  throw new InvalidChecksum(msg);
};

/**
 * Extracts the S3 bucket and key from the URL path parameters.
 *
 * @param {string} pathParams - path parameters from the URL
 * @returns {Array<string>} 2-element array containing the bucket and the key,
 *    respectively
 */
exports.getFileBucketAndKey = (pathParams) => {
  const fields = (pathParams.startsWith('/')
    ? pathParams.slice(1) // Remove leading slash
    : pathParams
  ).split('/');
  const Bucket = fields.shift();
  const Key = fields.join('/');

  if (Bucket.length === 0 || Key.length === 0) {
    throw new UnparsableFileLocationError(
      `File location '${pathParams}' could not be parsed`
    );
  }

  return [Bucket, Key];
};

/**
 * Create an S3 bucket
 *
 * @param {string} Bucket - the name of the S3 bucket to create
 * @returns {Promise}
 */
exports.createBucket = (Bucket) =>
  awsServices.s3().createBucket({ Bucket }).promise();

const GB = 1024 * 1024 * 1024;

const createMultipartChunks = (size, maxSize = 5 * GB) => {
  const lastChunkSize = size % maxSize;

  // Build the list of full-size chunks
  const chunks = range(0, size - lastChunkSize, maxSize).map((start) => {
    const end = start + maxSize - 1;
    return { start, end };
  });

  // If necessary build the last, not-full-size chunk
  if (lastChunkSize !== 0) {
    const start = size - lastChunkSize;
    const end = size - 1;
    chunks.push({ start, end });
  }

  return chunks;
};
exports.createMultipartChunks = createMultipartChunks;

// const createMultipartCopyObjectParts = (size, maxUploadSize = 5 * GB) => {
//   const numberOfFullParts = Math.floor(size / maxUploadSize);

//   // Build the list of full-size upload parts
//   const parts = range(numberOfFullParts).map((x) => {
//     const firstByte = x * maxUploadSize;
//     const lastByte = firstByte + maxUploadSize - 1;

//     return {
//       PartNumber: x + 1,
//       CopySourceRange: `bytes=${firstByte}-${lastByte}`
//     };
//   });

//   // If necessary, build the last, not-full-size upload part
//   if (size % maxUploadSize !== 0) {
//     const firstByte = numberOfFullParts * maxUploadSize;
//     const lastByte = size - 1;

//     parts.push({
//       PartNumber: numberOfFullParts + 1,
//       CopySourceRange: `bytes=${firstByte}-${lastByte}`
//     });
//   }

//   return parts;
// };
// exports.createMultipartCopyObjectParts = createMultipartCopyObjectParts;

const createMultipartUpload = async (params) => {
  const response = await awsServices.s3().createMultipartUpload(params).promise();
  return response.UploadId;
};

const completeMultipartUpload = async (params) => {
  await awsServices.s3().completeMultipartUpload(params).promise();
};

const abortMultipartUpload = (params) =>
  awsServices.s3().abortMultipartUpload(params).promise();

const uploadPartCopy = async (params) => {
  const response = await awsServices.s3().uploadPartCopy(params).promise();

  return {
    ...response,
    PartNumber: params.PartNumber
  };
};

const buildUploadPartCopyParams = ({
  chunks,
  destinationBucket,
  destinationKey,
  sourceBucket,
  sourceKey,
  uploadId
}) =>
  chunks.map(({ start, end }, index) => ({
    UploadId: uploadId,
    Bucket: destinationBucket,
    Key: destinationKey,
    PartNumber: index + 1,
    CopySource: `/${sourceBucket}/${sourceKey}`,
    CopySourceRange: `bytes=${start}-${end}`
  }));
exports.buildUploadPartCopyParams = buildUploadPartCopyParams;

const buildCompleteMultipartUploadParams = ({
  destinationBucket,
  destinationKey
}) => ({
  Bucket: destinationBucket,
  Key: destinationKey
});
exports.buildCompleteMultipartUploadParams = buildCompleteMultipartUploadParams;

// exports.multipartCopyObject = async (params = {}) => {
//   const {
//     sourceBucket,
//     sourceKey,
//     destinationBucket,
//     destinationKey
//   } = params;

//   const uploadId = await createMultipartUpload({
//     Bucket: destinationBucket,
//     Key: destinationKey
//   });

//   try {
//     const objectSize = await exports.getObjectSize(sourceBucket, sourceKey);

//     const chunks = createMultipartChunks(objectSize);

//     const uploadPartCopyParams = buildUploadPartCopyParams({
//       chunks,
//       destinationBucket,
//       destinationKey,
//       sourceBucket,
//       sourceKey,
//       uploadId
//     });

//     const uploadPartCopyResponses = await Promise.all(
//       uploadPartCopyParams.map(uploadPartCopy)
//     );

//     const completeMultipartUploadParams = buildCompleteMultipartUploadParams({
//       uploadPartCopyResponses,
//       destinationBucket,
//       destinationKey,
//       uploadId
//     });

//     await completeMultipartUpload({
//       Bucket: destinationBucket,
//       Key: destinationKey,
//       MultipartUpload: {
//         Parts: uploads
//       },
//       UploadId: uploadId
//     });
//   } catch (error) {
//     await abortMultipartUpload({
//       Bucket: destinationBucket,
//       Key: destinationKey,
//       UploadId: uploadId
//     });

//     throw error;
//   }
// };
