/**
 * @module S3
 */

import fs from 'fs';
import isBoolean from 'lodash/isBoolean';
import path from 'path';
import pMap from 'p-map';
import pRetry from 'p-retry';
import pWaitFor from 'p-wait-for';
import TimeoutError from 'p-timeout';
import pump from 'pump';
import querystring from 'querystring';
import { Readable, TransformOptions } from 'stream';
import { deprecate } from 'util';

import {
  CopyObjectCommandInput,
  CreateMultipartUploadRequest,
  DeleteObjectRequest,
  DeleteBucketCommandOutput,
  GetObjectCommandInput,
  GetObjectOutput,
  HeadObjectOutput,
  ListObjectsRequest,
  ListObjectsV2Request,
  ObjectCannedACL,
  PutObjectCommandInput,
  PutObjectRequest,
  S3,
  Tag,
  Tagging,
  ListObjectsCommandOutput,
  DeleteObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { Upload, Options as UploadOptions } from '@aws-sdk/lib-storage';

import {
  generateChecksumFromStream,
  validateChecksumFromStream,
} from '@cumulus/checksum';
import {
  InvalidChecksum,
  UnparsableFileLocationError,
} from '@cumulus/errors';
import Logger from '@cumulus/logger';

import * as S3MultipartUploads from './lib/S3MultipartUploads';
import { s3 } from './services';
import { inTestMode } from './test-utils';
import { improveStackTrace } from './utils';

const log = new Logger({ sender: 'aws-client/s3' });

export type GetObjectMethod = (params: GetObjectCommandInput) => Promise<GetObjectOutput>;

const buildDeprecationMessage = (
  name: string,
  version: string,
  alternative?: string
) => {
  let message = `${name} is deprecated after version ${version} and will be removed in a future release.`;
  if (alternative) message += ` Use ${alternative} instead.`;

  return log.buildMessage('warn', message);
};

const S3_RATE_LIMIT = inTestMode() ? 1 : 20;

/**
 * Join strings into an S3 key without a leading slash
 *
 * @param {...string|Array<string>} args - the strings to join
 * @returns {string} the full S3 key
 */
export const s3Join = (...args: [string | string[], ...string[]]) => {
  let tokens: string[];
  if (typeof args[0] === 'string') tokens = <string[]>args;
  else tokens = args[0];

  const removeLeadingSlash = (token: string) => token.replace(/^\//, '');
  const removeTrailingSlash = (token: string) => token.replace(/\/$/, '');
  const isNotEmptyString = (token: string) => token.length > 0;

  const key = tokens
    .map(removeLeadingSlash)
    .map(removeTrailingSlash)
    .filter(isNotEmptyString)
    .join('/');

  if (tokens[tokens.length - 1].endsWith('/')) return `${key}/`;
  return key;
};

/**
* parse an s3 uri to get the bucket and key
*
* @param {string} uri - must be a uri with the `s3://` protocol
* @returns {Object} Returns an object with `Bucket` and `Key` properties
**/
export const parseS3Uri = (uri: string) => {
  const match = uri.match('^s3://([^/]+)/(.*)$');

  if (match === null) {
    throw new TypeError(`Unable to parse S3 URI: ${uri}`);
  }

  return {
    Bucket: match[1],
    Key: match[2],
  };
};

/**
 * Given a bucket and key, return an S3 URI
 *
 * @param {string} bucket - an S3 bucket name
 * @param {string} key - an S3 key
 * @returns {string} an S3 URI
 */
export const buildS3Uri = (bucket: string, key: string) =>
  `s3://${bucket}/${key.replace(/^\/+/, '')}`;

/**
* Convert S3 TagSet Object to query string
* e.g. [{ Key: 'tag', Value: 'value }] to 'tag=value'
*
* @param {Array<Object>} tagset - S3 TagSet array
* @returns {string} tags query string
*/
export const s3TagSetToQueryString = (tagset: Tagging['TagSet']) =>
  tagset?.map(({ Key, Value }) => `${Key}=${Value}`).join('&');

/**
 * Delete an object from S3
 *
 * @param {string} bucket - bucket where the object exists
 * @param {string} key - key of the object to be deleted
 * @returns {Promise} promise of the object being deleted
 */
export const deleteS3Object = (bucket: string, key: string) =>
  s3().deleteObject({ Bucket: bucket, Key: key });

export const deleteS3Objects = (params: {
  client: S3,
  bucket: string,
  keys: string[],
}) => {
  const { bucket, client, keys } = params;
  const objects = {
    Bucket: bucket,
    Delete: {
      Objects: keys.map((key) => ({ Key: key })),
    },
  };
  return client.deleteObjects(objects);
};

/**
* Get an object header from S3
*
* @param Bucket - name of bucket
* @param Key - key for object (filepath + filename)
* @param retryOptions - options to control retry behavior when an
*   object does not exist. See https://github.com/tim-kos/node-retry#retryoperationoptions
*   By default, retries will not be performed
* @returns  returns response from `S3.headObject` as a promise
**/
export const headObject = (
  Bucket: string,
  Key: string,
  retryOptions: pRetry.Options = { retries: 0 }
): Promise<HeadObjectOutput> =>
  pRetry(
    async () => {
      try {
        return await s3().headObject({ Bucket, Key });
      } catch (error) {
        if (error.name === 'NotFound') throw error;
        throw new pRetry.AbortError(error);
      }
    },
    { maxTimeout: 10000, ...retryOptions }
  );

/**
 * Test if an object exists in S3
 *
 * @param {Object} params - same params as https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#headObject-property
 * @returns {Promise<boolean>} a Promise that will resolve to a boolean indicating
 *                               if the object exists
 */
export const s3ObjectExists = (params: { Bucket: string, Key: string }) =>
  headObject(params.Bucket, params.Key)
    .then(() => true)
    .catch((error) => {
      if (error.name === 'NotFound') return false;
      throw error;
    });

/**
 * Wait for an object to exist in S3
 *
 * @param {Object} params
 * @param {string} params.bucket
 * @param {string} params.key
 * @param {number} [params.interval=1000] - interval before retries, in ms
 * @param {number} [params.timeout=30000] - timeout, in ms
 * @returns {Promise<undefined>}
 */
export const waitForObjectToExist = async (params: {
  bucket: string,
  key: string,
  interval: number,
  timeout: number
}) => {
  const {
    bucket,
    key,
    interval = 1000,
    timeout = 30 * 1000,
  } = params;

  try {
    await pWaitFor(
      () => s3ObjectExists({ Bucket: bucket, Key: key }),
      { interval, timeout }
    );
  } catch (error) {
    if (error instanceof TimeoutError) {
      log.error(`Timed out after ${timeout}ms waiting for existence of s3://${bucket}/${key}`);
    } else {
      log.error(`Unexpected error while waiting for existence of s3://${bucket}/${key}: ${error}`);
    }
    throw error;
  }
};

/**
* Put an object on S3
*
* @param {Object} params - same params as https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObject-property
* promise of the object being put
* @returns {Promise}
**/
export const s3PutObject = (params: PutObjectCommandInput) => s3().putObject(params);

/**
 * Upload a file to S3
 *
 * @param {string} bucket - the destination S3 bucket
 * @param {string} key - the destination S3 key
 * @param {filename} filename - the local file to be uploaded
 * @returns {Promise}
 */
export const putFile = (bucket: string, key: string, filename: string) =>
  s3PutObject({
    Bucket: bucket,
    Key: key,
    Body: fs.createReadStream(filename),
  });

/**
* Copy an object from one location on S3 to another
*
* @param {Object} params - same params as https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObject-property
* @returns {Promise} promise of the object being copied
**/
export const s3CopyObject = (params: CopyObjectCommandInput) => s3().copyObject({
  TaggingDirective: 'COPY',
  ...params,
});

/**
 * Upload data to S3
 *
 * see https://github.com/aws/aws-sdk-js-v3/tree/main/lib/lib-storage
 *
 * @param {UploadOptions} params
 * @returns {Promise}
 */
export const promiseS3Upload = async (
  params: Omit<UploadOptions, 'client'>
): Promise<{ ETag?: string, [key: string]: any }> => {
  const parallelUploads = new Upload({
    ...params,
    client: s3(),
  });

  parallelUploads.on('httpUploadProgress', (progress) => {
    log.info(progress);
  });

  const result = await parallelUploads.done();
  return result;
};

/**
 * Upload data to S3 using a stream
 *
 * @param {Readable} uploadStream - Stream of data to upload
 * @param {Object} uploadParams
 * @returns {Promise}
 */
export const streamS3Upload = (
  uploadStream: Readable,
  uploadParams: UploadOptions
) => {
  const parallelUploads3 = new Upload({
    ...uploadParams,
    params: {
      ...uploadParams.params,
      Body: uploadStream,
    },
    client: s3(),
  });

  parallelUploads3.on('httpUploadProgress', (progress) => {
    log.info(progress);
  });

  return parallelUploads3.done();
};

/**
 * Get a readable stream for an S3 object
 *
 * @param {Object} params
 * @param {S3} params.s3 - an S3 instance
 * @param {string} params.bucket - the bucket of the requested object
 * @param {string} params.key - the key of the requested object
 * @returns {Promise<Readable>}
 */
export const getObjectReadStream = async (params: {
  s3: { getObject: GetObjectMethod },
  bucket: string,
  key: string
}): Promise<Readable> => {
  // eslint-disable-next-line no-shadow
  const { s3: s3Client, bucket, key } = params;
  const response = await s3Client.getObject({ Bucket: bucket, Key: key });
  if (!response.Body) {
    throw new Error(`Could not get object for bucket ${bucket} and key ${key}`);
  }

  if (!(response.Body instanceof Readable)) {
    throw new TypeError('Unknown object stream type.');
  }

  return response.Body;
};

/**
 * Downloads the given s3Obj to the given filename in a streaming manner
 *
 * @param {Object} s3Obj - The parameters to send to S3 getObject call
 * @param {string} filepath - The filepath of the file that is downloaded
 * @returns {Promise<string>} returns filename if successful
 */
export const downloadS3File = async (
  s3Obj: GetObjectCommandInput,
  filepath: string
): Promise<string> => {
  if (!s3Obj.Bucket || !s3Obj.Key) {
    throw new Error('Bucket and Key are required');
  }

  const fileWriteStream = fs.createWriteStream(filepath);

  const objectStream = await getObjectReadStream({
    bucket: s3Obj.Bucket,
    key: s3Obj.Key,
    s3: s3(),
  });

  return new Promise(
    (resolve, reject) => pump(objectStream, fileWriteStream, (err) => {
      if (err) reject(err);
      else resolve(filepath);
    })
  );
};

/**
 * Get the size of an S3 object
 *
 * @param {Object} params
 * @param {string} params.bucket
 * @param {string} params.key
 * @param {S3} params.s3 - an S3 client instance
 * @returns {Promise<number|undefined>} object size, in bytes
 */
export const getObjectSize = async (
  params: {
    s3: S3,
    bucket: string,
    key: string
  }
) => {
  // eslint-disable-next-line no-shadow
  const { s3: s3Client, bucket, key } = params;

  const headObjectResponse = await s3Client.headObject({
    Bucket: bucket,
    Key: key,
  });

  return headObjectResponse.ContentLength;
};

/**
* Get object Tagging from S3
*
* @param {string} bucket - name of bucket
* @param {string} key - key for object (filepath + filename)
* @returns {Promise<GetObjectTaggingOutput>} the promised response from `S3.getObjectTagging`
**/
export const s3GetObjectTagging = (bucket: string, key: string) =>
  s3().getObjectTagging({ Bucket: bucket, Key: key });

const getObjectTags = async (bucket: string, key: string) => {
  const taggingResponse = await s3GetObjectTagging(bucket, key);

  return taggingResponse?.TagSet?.reduce(
    (accumulator, { Key, Value }: Tag) => {
      if (Key && Value) {
        return { ...accumulator, [Key]: Value };
      }
      return accumulator;
    },
    {}
  );
};

const getObjectTaggingString = async (bucket: string, key: string) => {
  const tags = await getObjectTags(bucket, key);

  return querystring.stringify(tags);
};

/**
* Puts object Tagging in S3
* https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObjectTagging-property
*
* @param {string} Bucket - name of bucket
* @param {string} Key - key for object (filepath + filename)
* @param {Object} ObjectTagging - tagging object
* @returns {Promise} returns response from `S3.getObjectTagging` as a promise
**/
export const s3PutObjectTagging = (Bucket: string, Key: string, ObjectTagging: Tagging) =>
  s3().putObjectTagging({
    Bucket,
    Key,
    Tagging: ObjectTagging,
  });

/**
 * Gets an object from S3.
 *
 * @example
 * const obj = await getObject(s3(), { Bucket: 'b', Key: 'k' })
 *
 * @param {S3} s3Client - an `S3` instance
 * @param {GetObjectCommandInput} params - parameters object to pass through
 *   to `S3.getObject()`
 * @returns {Promise<GetObjectOutput>} response from `S3.getObject()`
 *   as a Promise
 */
export const getObject = (
  s3Client: S3,
  params: GetObjectCommandInput
): Promise<GetObjectOutput> => s3Client.getObject(params);

/**
 * Get an object from S3, waiting for it to exist and, if specified, have the
 * correct ETag.
 *
 * @param {S3} s3Client
 * @param {GetObjectCommandInput} params
 * @param {pRetry.Options} [retryOptions={}]
 * @returns {Promise<GetObjectOutput>}
 */
export const waitForObject = (
  s3Client: S3,
  params: GetObjectCommandInput,
  retryOptions: pRetry.Options = {}
): Promise<GetObjectOutput> =>
  pRetry(
    async () => {
      try {
        return await getObject(s3Client, params);
      } catch (error) {
        // Retry if the object does not exist
        if (error.name === 'NoSuchKey') throw error;

        // Retry if the etag did not match
        if (params.IfMatch && error.name === 'PreconditionFailed') throw error;

        // For any other error, fail without retrying
        throw new pRetry.AbortError(error);
      }
    },
    retryOptions
  );

/**
 * Gets an object from S3.
 *
 * @param {string} Bucket - name of bucket
 * @param {string} Key - key for object (filepath + filename)
 * @param {Object} retryOptions - options to control retry behavior when an
 *   object does not exist. See https://github.com/tim-kos/node-retry#retryoperationoptions
 *   By default, retries will not be performed
 * @returns {Promise} returns response from `S3.getObject` as a promise
 *
 * @deprecated
 */
export const getS3Object = deprecate(
  (Bucket: string, Key: string, retryOptions: pRetry.Options = { retries: 0 }) =>
    waitForObject(
      s3(),
      { Bucket, Key },
      {
        maxTimeout: 10000,
        onFailedAttempt: (err) => log.debug(`getS3Object('${Bucket}', '${Key}') failed with ${err.retriesLeft} retries left: ${err.message}`),
        ...retryOptions,
      }
    ),
  buildDeprecationMessage(
    '@cumulus/aws-client/S3.getS3Object',
    '2.0.1',
    '@cumulus/aws-client/S3.getObject or @cumulus/aws-client/S3.waitForObject'
  )
);

export const getObjectStreamBuffers = (
  objectReadStream: Readable
): Promise<Buffer[]> => new Promise(
  (resolve, reject) => {
    try {
      const responseDataChunks: Buffer[] = [];

      objectReadStream.once('error', (error) => reject(error));
      objectReadStream.on('data', (chunk) => responseDataChunks.push(chunk));

      // Once the stream has no more data, join the chunks into a string and
      // return the string
      objectReadStream.once('end', () => resolve(responseDataChunks));
    } catch (error) {
      reject(error);
    }
  }
);

/**
 * Transform streaming response from S3 object to text content
 *
 * @param {Readable} objectReadStream - Readable stream of S3 object
 * @returns {Promise<string>} the contents of the S3 object
 */
export const getObjectStreamContents = async (
  objectReadStream: Readable
): Promise<string> => {
  const buffers = await getObjectStreamBuffers(objectReadStream);
  return buffers.join('');
};

/**
 * Fetch the contents of an S3 object
 *
 * @param {string} bucket - the S3 object's bucket
 * @param {string} key - the S3 object's key
 * @returns {Promise<string>} the contents of the S3 object
 */
export const getTextObject = (bucket: string, key: string): Promise<string> =>
  getObjectReadStream({ s3: s3(), bucket, key })
    .then((objectReadStream) => getObjectStreamContents(objectReadStream));

/**
 * Fetch JSON stored in an S3 object
 * @param {string} bucket - the S3 object's bucket
 * @param {string} key - the S3 object's key
 * @returns {Promise<*>} the contents of the S3 object, parsed as JSON
 */
export const getJsonS3Object = (bucket: string, key: string) =>
  getTextObject(bucket, key)
    .then((text) => {
      if (text === undefined) return undefined;
      return JSON.parse(text);
    });

export const putJsonS3Object = (bucket: string, key: string, data: any) =>
  s3PutObject({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(data),
  });

/**
* Check if a file exists in an S3 object
*
* @param {string} bucket - name of the S3 bucket
* @param {string} key - key of the file in the S3 bucket
* @returns {Promise} returns the response from `S3.headObject` as a promise
**/
export const fileExists = async (bucket: string, key: string) => {
  try {
    return await s3().headObject({ Key: key, Bucket: bucket });
  } catch (error) {
    // if file is not return false
    if (error.stack.match(/(NotFound)/) || error.stack.match(/(NoSuchBucket)/)) {
      return false;
    }
    throw error;
  }
};

/**
 * Delete files from S3
 *
 * @param {Array} s3Objs - An array of objects containing keys 'Bucket' and 'Key'
 * @returns {Promise} A promise that resolves to an Array of the data returned
 *   from the deletion operations
 */
export const deleteS3Files = async (s3Objs: DeleteObjectRequest[]) => await pMap(
  s3Objs,
  (s3Obj) => s3().deleteObject(s3Obj),
  { concurrency: S3_RATE_LIMIT }
);

type FileInfo = {
  filename: string,
  key: string,
  bucket: string
};

export const uploadS3Files = async (
  files: Array<string | FileInfo>,
  defaultBucket: string,
  keyPath: string | ((x: string) => string),
  s3opts: Partial<PutObjectRequest> = {}
) => {
  let i = 0;
  const n = files.length;
  if (n > 1) {
    log.info(`Starting upload of ${n} keys`);
  }
  const promiseUpload = async (file: string | FileInfo) => {
    let bucket: string;
    let filename: string;
    let key: string;

    if (typeof file === 'string') {
      bucket = defaultBucket;
      filename = file;

      if (typeof keyPath === 'string') {
        key = s3Join(keyPath, path.basename(file));
      } else {
        key = keyPath(file);
      }
    } else {
      bucket = file.bucket || defaultBucket;
      filename = file.filename;
      key = file.key;
    }

    await promiseS3Upload({
      ...s3opts,
      params: {
        Bucket: bucket,
        Key: key,
        Body: fs.createReadStream(filename),
      },
    });

    i += 1;

    log.info(`Progress: [${i} of ${n}] ${filename} -> s3://${bucket}/${key}`);

    return { key, bucket };
  };

  return await pMap(files, promiseUpload, { concurrency: S3_RATE_LIMIT });
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
export const uploadS3FileStream = (
  fileStream: Readable,
  bucket: string,
  key: string,
  s3opts: Partial<PutObjectRequest> = {}
) =>
  promiseS3Upload({
    params: {
      ...s3opts,
      Bucket: bucket,
      Key: key,
      Body: fileStream,
    },
  });

/**
 * List the objects in an S3 bucket
 */
export const listS3Objects = async (
  bucket: string,
  prefix?: string,
  skipFolders: boolean = true
): Promise<ListObjectsCommandOutput['Contents']> => {
  log.info(`Listing objects in s3://${bucket}`);
  const params: ListObjectsRequest = {
    Bucket: bucket,
  };
  if (prefix) params.Prefix = prefix;

  const data = await s3().listObjects(params);
  if (!data.Contents) {
    return [];
  }
  let contents = data.Contents.filter((obj) => obj.Key !== undefined);
  if (skipFolders) {
    // Filter out any references to folders
    contents = contents.filter((obj) => obj.Key && !obj.Key.endsWith('/'));
  }
  return contents;
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
 * @returns {Promise<Array>} resolves to an array of objects corresponding to
 *   the Contents property of the listObjectsV2 response
 *
 * @static
 */
export const listS3ObjectsV2 = async (
  params: ListObjectsV2Request
): Promise<ListObjectsCommandOutput['Contents']> => {
  // Fetch the first list of objects from S3
  let listObjectsResponse = await s3().listObjectsV2(params);

  let discoveredObjects = listObjectsResponse.Contents ?? [];

  // Keep listing more objects from S3 until we have all of them
  while (listObjectsResponse.IsTruncated) {
    // eslint-disable-next-line no-await-in-loop
    listObjectsResponse = (await s3().listObjectsV2(
      // Update the params with a Continuation Token
      {

        ...params,
        ContinuationToken: listObjectsResponse.NextContinuationToken,
      }
    ));
    discoveredObjects = discoveredObjects.concat(listObjectsResponse.Contents ?? []);
  }

  return discoveredObjects.filter((obj) => obj.Key);
};

/**
 * Fetch lazy list of S3 objects
 *
 * listObjectsV2 is limited to 1,000 results per call.  This function continues
 * listing objects until there are no more to be fetched.
 *
 * The passed params must be compatible with the listObjectsV2 call.
 *
 * https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#listObjectsV2-property
 *
 * @param params - params for the s3.listObjectsV2 call
 * @yields a series of objects corresponding to
 *   the Contents property of the listObjectsV2 response
 *   batched to allow processing of one chunk at a time
 *
 * @static
 */
export async function* listS3ObjectsV2Batch(
  params: ListObjectsV2Request
): AsyncIterable<ListObjectsCommandOutput['Contents']> {
  let listObjectsResponse = await s3().listObjectsV2(params);

  let discoveredObjects = listObjectsResponse.Contents ?? [];
  yield discoveredObjects.filter((obj) => 'Key' in obj);
  // Keep listing more objects from S3 until we have all of them
  while (listObjectsResponse.IsTruncated) {
    // eslint-disable-next-line no-await-in-loop
    listObjectsResponse = (await s3().listObjectsV2(
      // Update the params with a Continuation Token
      {

        ...params,
        ContinuationToken: listObjectsResponse.NextContinuationToken,
      }
    ));
    discoveredObjects = listObjectsResponse.Contents ?? [];
    yield discoveredObjects.filter((obj) => 'Key' in obj);
  }
}
/**
* Delete a bucket and all of its objects from S3
*
* @param bucket - name of the bucket
* @returns the promised result of `S3.deleteBucket`
**/
export const recursivelyDeleteS3Bucket = improveStackTrace(
  async (bucket: string): Promise<DeleteBucketCommandOutput> => {
    for await (
      const objectBatch of listS3ObjectsV2Batch({ Bucket: bucket })
    ) {
      if (objectBatch) {
        const deleteRequests = objectBatch.filter(
          (obj) => obj.Key
        ).map((obj) => ({ Bucket: bucket, Key: obj.Key }));
        await deleteS3Files(deleteRequests);
      }
    }
    return await s3().deleteBucket({ Bucket: bucket });
  }
);

/**
* Delete a list of buckets and all of their objects from S3
*
* @param {Array} buckets - list of bucket names
* @returns {Promise} the promised result of `S3.deleteBucket`
**/
export const deleteS3Buckets = async (
  buckets: Array<string>
): Promise<any> => await Promise.all(buckets.map(recursivelyDeleteS3Bucket));

/**
 * Calculate the cryptographic hash of an S3 object
 *
 * @param {Object} params
 * @param {S3} params.s3 - an S3 instance
 * @param {string} params.algorithm - `cksum`, or an algorithm listed in
 *   `openssl list -digest-algorithms`
 * @param {string} params.bucket
 * @param {string} params.key
 */
export const calculateObjectHash = async (
  params: {
    s3: { getObject: GetObjectMethod },
    algorithm: string,
    bucket: string,
    key: string
  }
) => {
  // eslint-disable-next-line no-shadow
  const { algorithm, bucket, key, s3: s3Client } = params;

  const stream = await getObjectReadStream({
    s3: s3Client,
    bucket,
    key,
  });

  return await generateChecksumFromStream(algorithm, stream);
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
 * @returns {Promise<boolean>} returns true for success
 */
export const validateS3ObjectChecksum = async (params: {
  algorithm: string,
  bucket: string,
  key: string,
  expectedSum: string,
  options: TransformOptions
}) => {
  const { algorithm, bucket, key, expectedSum, options } = params;
  const fileStream = await getObjectReadStream({ s3: s3(), bucket, key });
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
 * bucket/key in the form of
 * @returns {Array<string>} `[Bucket, Key]`
 */
export const getFileBucketAndKey = (pathParams: string): [string, string] => {
  const [Bucket, ...fields] = pathParams.split('/');

  const Key = fields.join('/');

  if (Bucket.length === 0 || Key.length === 0) {
    throw new UnparsableFileLocationError(`File location "${pathParams}" could not be parsed`);
  }

  return [Bucket, Key];
};

/**
 * Create an S3 bucket
 *
 * @param {string} Bucket - the name of the S3 bucket to create
 * @returns {Promise}
 */
export const createBucket = (Bucket: string) =>
  s3().createBucket({ Bucket });

/**
 * Create multiple S3 buckets
 *
 * @param {Array<string>} buckets - the names of the S3 buckets to create
 * @returns {Promise}
 */
export const createS3Buckets = async (
  buckets: Array<string>
): Promise<any> => await Promise.all(buckets.map(createBucket));

const createMultipartUpload = async (
  params: {
    sourceBucket: string,
    sourceKey: string,
    destinationBucket: CreateMultipartUploadRequest['Bucket'],
    destinationKey: CreateMultipartUploadRequest['Key'],
    ACL?: ObjectCannedACL,
    copyTags?: boolean,
    contentType?: CreateMultipartUploadRequest['ContentType']
  }
) => {
  const uploadParams: CreateMultipartUploadRequest = {
    Bucket: params.destinationBucket,
    Key: params.destinationKey,
    ACL: params.ACL,
    ContentType: params.contentType,
  };

  if (params.copyTags) {
    uploadParams.Tagging = await getObjectTaggingString(
      params.sourceBucket,
      params.sourceKey
    );
  }

  // Create a multi-part upload (copy) and get its UploadId
  const { UploadId } = await S3MultipartUploads.createMultipartUpload(
    uploadParams
  );

  if (UploadId === undefined) {
    throw new Error('Unable to create multipart upload');
  }

  return UploadId;
};

// This performs an S3 `uploadPartCopy` call. That response includes an `ETag`
// value specific to the part that was uploaded. When `completeMultipartUpload`
// is called later, it needs that `ETag` value, as well as the `PartNumber` for
// each part. Since the `PartNumber` is not included in the `uploadPartCopy`
// response, we are adding it here to make our lives easier when we eventually
// call `completeMultipartUpload`.
const uploadPartCopy = async (
  params: {
    partNumber: number,
    start: number,
    end: number,
    destinationBucket: string,
    destinationKey: string,
    sourceBucket: string,
    sourceKey: string,
    uploadId: string
  }
) => {
  const response = await S3MultipartUploads.uploadPartCopy({
    UploadId: params.uploadId,
    Bucket: params.destinationBucket,
    Key: params.destinationKey,
    PartNumber: params.partNumber,
    CopySource: `/${params.sourceBucket}/${params.sourceKey}`,
    CopySourceRange: `bytes=${params.start}-${params.end}`,
  });

  if (response.CopyPartResult === undefined) {
    throw new Error('Did not get ETag from uploadPartCopy');
  }

  return {
    ETag: response.CopyPartResult.ETag,
    PartNumber: params.partNumber,
  };
};

/**
 * Copy an S3 object to another location in S3 using a multipart copy
 *
 * @param {Object} params
 * @param {string} params.sourceBucket
 * @param {string} params.sourceKey
 * @param {string} params.destinationBucket
 * @param {string} params.destinationKey
 * @param {S3.HeadObjectOutput} [params.sourceObject]
 *   Output from https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#headObject-property
 * @param {string} [params.ACL] - an [S3 Canned ACL](https://docs.aws.amazon.com/AmazonS3/latest/dev/acl-overview.html#canned-acl)
 * @param {boolean} [params.copyTags=false]
 * @param {number} [params.chunkSize] - chunk size of the S3 multipart uploads
 * @returns {Promise.<{ etag: string }>} object containing the ETag of the
 *    destination object
 *
 * note: this method may error if used with zero byte files. see CUMULUS-2557 and https://github.com/nasa/cumulus/pull/2117.
 */
export const multipartCopyObject = async (
  params: {
    sourceBucket: string,
    sourceKey: string,
    destinationBucket: string,
    destinationKey: string,
    sourceObject?: HeadObjectOutput,
    ACL?: ObjectCannedACL | string,
    copyTags?: boolean,
    chunkSize?: number
  }
): Promise<{ etag: string }> => {
  const {
    sourceBucket,
    sourceKey,
    destinationBucket,
    destinationKey,
    ACL,
    copyTags = false,
    chunkSize,
  } = params;

  const sourceObject = params.sourceObject ?? await headObject(sourceBucket, sourceKey);

  // Create a multi-part upload (copy) and get its UploadId
  const uploadId = await createMultipartUpload({
    sourceBucket,
    sourceKey,
    destinationBucket,
    destinationKey,
    ACL: <ObjectCannedACL>ACL,
    copyTags,
    contentType: sourceObject.ContentType,
  });

  try {
    // Build the separate parts of the multi-part upload (copy)
    const objectSize = sourceObject.ContentLength;

    if (objectSize === undefined) {
      throw new Error(`Unable to determine size of s3://${sourceBucket}/${sourceKey}`);
    }

    const chunks = S3MultipartUploads.createMultipartChunks(objectSize, chunkSize);

    // Submit all of the upload (copy) parts to S3
    const uploadPartCopyResponses = await Promise.all(
      chunks.map(
        ({ start, end }, index) =>
          uploadPartCopy({
            uploadId,
            partNumber: index + 1,
            start,
            end,
            sourceBucket,
            sourceKey,
            destinationBucket,
            destinationKey,
          })
      )
    );

    // Let S3 know that the multi-part upload (copy) is completed
    const { ETag: etag } = await S3MultipartUploads.completeMultipartUpload({
      UploadId: uploadId,
      Bucket: destinationBucket,
      Key: destinationKey,
      MultipartUpload: {
        Parts: uploadPartCopyResponses,
      },
    });

    return { etag };
  } catch (error) {
    // If anything went wrong, make sure that the multi-part upload (copy)
    // is aborted.
    await S3MultipartUploads.abortMultipartUpload({
      Bucket: destinationBucket,
      Key: destinationKey,
      UploadId: uploadId,
    });

    throw error;
  }
};

/**
 * Copy an S3 object to another location in S3
 */
export const copyObject = async (
  params: {
    sourceBucket: string,
    sourceKey: string,
    destinationBucket: string,
    destinationKey: string,
    ACL?: string,
    copyTags?: boolean,
    chunkSize?: number
  }
): Promise<void> => {
  const {
    sourceBucket,
    sourceKey,
    destinationBucket,
    destinationKey,
    ACL,
    copyTags,
    chunkSize,
  } = params;

  const sourceObject = await headObject(sourceBucket, sourceKey);

  if (sourceObject.ContentLength === 0) {
    // 0 byte files cannot be copied with multipart upload,
    // so use a regular S3 PUT
    const s3uri = buildS3Uri(destinationBucket, destinationKey);

    const { CopyObjectResult } = await s3CopyObject({
      CopySource: path.join(sourceBucket, sourceKey),
      Bucket: destinationBucket,
      Key: destinationKey,
    });
    // This error should never actually be reached in practice. It's a
    // necessary workaround for bad typings in the AWS SDK.
    // https://github.com/aws/aws-sdk-js/issues/1719
    if (!CopyObjectResult?.ETag) {
      throw new Error(
        `ETag could not be determined for copy of ${buildS3Uri(sourceBucket, sourceKey)} to ${s3uri}`
      );
    }
  } else {
    await multipartCopyObject({
      sourceBucket: sourceBucket,
      sourceKey: sourceKey,
      destinationBucket: destinationBucket,
      destinationKey: destinationKey,
      sourceObject: sourceObject,
      ACL: <ObjectCannedACL>ACL,
      copyTags: isBoolean(copyTags) ? copyTags : true,
      chunkSize: chunkSize,
    });
  }
};

/**
 * Move an S3 object to another location in S3
 */
export const moveObject = async (
  params: {
    sourceBucket: string,
    sourceKey: string,
    destinationBucket: string,
    destinationKey: string,
    ACL?: string,
    copyTags?: boolean,
    chunkSize?: number
  }
): Promise<DeleteObjectCommandOutput> => {
  const {
    sourceBucket,
    sourceKey,
  } = params;

  await copyObject(params);
  const deleteS3ObjRes = await deleteS3Object(sourceBucket, sourceKey);
  return deleteS3ObjRes;
};
