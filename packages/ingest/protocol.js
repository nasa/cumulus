'use strict';

const path = require('path');
const aws = require('@cumulus/common/aws');
const fs = require('fs');
const log = require('@cumulus/common/log');

/**
 * the base class mixin used by all the protocol sub-classes
 * such as http/ftp/sftp/s3, etc.
 *
 * The base class mixin defines the methods that has to be implemented
 * by other mixins. It also provides a unified upload method
 * to S3
 */
module.exports.baseProtocol = superclass => class extends superclass {

  /**
   * List files of a given path
   *
   * @returns {Array.<Object>} returns the list of files
   */
  list() {
    throw new TypeError('method not implemented');
  }

  /**
   * Download a given url and upload to a given S3 location
   *
   * @returns {*} undefined
   */
  sync() {
    throw new TypeError('method not implemented');
  }

  /**
   * Upload a file to S3
   *
   * @param {string} bucket - the S3 bucket to upload to
   * @param {string} key - the base path of the S3 key
   * @param {string} filename - the filename to be uploaded to
   * @param {string} tempFile - the location of the file to be uploaded
   * @returns {Promise<string>} - the S3 URL that the file was uploaded to
   */
  async upload(bucket, key, filename, tempFile) {
    let fullKey = path.join(key, filename);

    // handle the edge case where leading / in key creates incorrect path
    // by remove the first slash if it exists
    if (fullKey[0] === '/') {
      fullKey = fullKey.substr(1);
    }

    await aws.s3().putObject({
      Bucket: bucket,
      Key: fullKey,
      Body: fs.createReadStream(tempFile)
    }).promise();

    const s3Uri = `s3://${bucket}/${fullKey}`;
    log.info(`uploaded ${s3Uri}`);

    return s3Uri;
  }

  /**
   * Download the file to disk, difference with sync is that
   * this method involves no uploading to S3
   *
   * @returns {*} undefined
   */
  download() {
    throw new TypeError('method not implemented');
  }

  /**
   * Write data to the server
   *
   * @returns {*} undefined
   */
  write() {
    throw new TypeError('method not implemented');
  }
};
