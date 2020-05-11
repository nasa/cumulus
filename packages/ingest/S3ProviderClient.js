'use strict';

const S3 = require('@cumulus/aws-client/S3');
const log = require('@cumulus/common/log');
const errors = require('@cumulus/errors');
const isString = require('lodash/isString');
const { basename, dirname } = require('path');

const GB = 1024 * 1024 * 1024;

const getObjectSize = async (bucket, key) => {
  try {
    return await S3.getObjectSize(bucket, key);
  } catch (error) {
    if (error.code === 'NotFound') {
      const s3Uri = S3.buildS3Uri(bucket, key);
      throw new errors.FileNotFound(`Source file not found ${s3Uri}`);
    }

    throw error;
  }
};

class S3ProviderClient {
  constructor({ bucket } = {}) {
    if (!isString(bucket)) throw new TypeError('bucket is required');
    this.bucket = bucket;
  }

  /**
   * Download a remote file to disk
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} localPath - the full local destination file path
   * @returns {Promise<string>} - the path that the file was saved to
   */
  async download(remotePath, localPath) {
    const remoteUrl = `s3://${this.bucket}/${remotePath}`;
    log.info(`Downloading ${remoteUrl} to ${localPath}`);

    const s3Obj = {
      Bucket: this.bucket,
      Key: remotePath
    };

    const retval = await S3.downloadS3File(s3Obj, localPath);
    log.info(`Finishing downloading ${remoteUrl}`);

    return retval;
  }

  /**
   * List all files from a given endpoint
   *
   * @param {string} path - the remote path to list
   * @returns {Promise<Array>} a list of files
   * @private
   */
  async list(path) {
    const objects = await S3.listS3ObjectsV2({
      Bucket: this.bucket,
      FetchOwner: true,
      Prefix: path
    });

    return objects.map(({ Key, Size, LastModified }) => ({
      name: basename(Key),
      // If the object is at the top level of the bucket, path.dirname is going
      // to return "." as the dirname.  It should instead be null.
      path: dirname(Key) === '.' ? null : dirname(Key),
      size: Size,
      time: (new Date(LastModified)).valueOf()
    }));
  }

  /**
   * Download the remote file to a given s3 location
   *
   * @param {string} sourceKey - the full path to the remote file to be fetched
   * @param {string} destinationBucket - destination s3 bucket of the file
   * @param {string} destinationKey - destination s3 key of the file
   * @returns {Promise<string>} s3 uri of destination file
   */
  async sync(sourceKey, destinationBucket, destinationKey) {
    const sourceBucket = this.bucket;

    const sourceUri = S3.buildS3Uri(sourceBucket, sourceKey);
    const destinationUri = S3.buildS3Uri(destinationBucket, destinationKey);

    log.info(`Copying ${sourceUri} to ${destinationUri}`);

    const objectSize = await getObjectSize(sourceBucket, sourceKey);

    if (objectSize > (5 * GB)) {
      await S3.multipartCopyObject({
        sourceBucket,
        sourceKey,
        destinationBucket,
        destinationKey
      });
    } else {
      await S3.s3CopyObject({
        Bucket: destinationBucket,
        CopySource: `${sourceBucket}/${sourceKey}`,
        Key: destinationKey,
        ACL: 'private'
      });
    }

    return destinationUri;
  }
}

module.exports = S3ProviderClient;
