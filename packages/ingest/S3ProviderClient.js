'use strict';

const S3 = require('@cumulus/aws-client/S3');
const log = require('@cumulus/common/log');
const errors = require('@cumulus/errors');
const isString = require('lodash/isString');
const { basename, dirname } = require('path');
const {
  emptyProviderConnectEndMixin
} = require('./emptyProviderConnectEndMixin');

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
      // to return "." as the dirname.  It should instead be undefined.
      path: dirname(Key) === '.' ? undefined : dirname(Key),
      size: Size,
      time: LastModified.valueOf()
    }));
  }

  /**
   * Download the remote file to a given s3 location
   *
   * @param {string} sourceKey - the full path to the remote file to be fetched
   * @param {string} destinationBucket - destination s3 bucket of the file
   * @param {string} destinationKey - destination s3 key of the file
   * @returns {Promise.<{ s3uri: string, etag: string }>} an object containing
   *    the S3 URI and ETag of the destination file
   */
  async sync(sourceKey, destinationBucket, destinationKey) {
    try {
      const s3uri = S3.buildS3Uri(destinationBucket, destinationKey);
      const { etag } = await S3.multipartCopyObject({
        sourceBucket: this.bucket,
        sourceKey,
        destinationBucket,
        destinationKey,
        ACL: 'private',
        copyTags: true
      });

      return { s3uri, etag };
    } catch (error) {
      if (error.code === 'NotFound' || error.code === 'NoSuchKey') {
        const sourceUrl = S3.buildS3Uri(this.bucket, sourceKey);
        throw new errors.FileNotFound(`Source file not found ${sourceUrl}`);
      }

      throw error;
    }
  }
}

Object.assign(
  S3ProviderClient.prototype,
  emptyProviderConnectEndMixin
);

module.exports = S3ProviderClient;
