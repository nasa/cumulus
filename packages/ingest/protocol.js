'use strict';

const aws = require('@cumulus/common/aws');
const fs = require('fs-extra');
const log = require('@cumulus/common/log');
const os = require('os');
const path = require('path');

/**
 * The base class mixin used by all the protocol sub-classes
 * such as http/https/ftp/sftp/s3, etc.
 *
 * The base class mixin defines the methods that has to be implemented
 * by other mixins. It also provides a unified upload method
 * to S3
 *
 * @param {*} superclass
 * @returns {*}
 */
module.exports.baseProtocol = (superclass) => class extends superclass {
  /**
   * Create a temporary directory
   *
   * @returns {string} - a temporary directory name
   */
  createDownloadDirectory() {
    const prefix = `${os.tmpdir()}${path.sep}`;
    return fs.mkdtemp(prefix);
  }

  /**
   * List files of a given path
   */
  list() {
    throw new TypeError('method not implemented');
  }

  /**
   * Download the remote file to a given s3 location
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

    await aws.s3PutObject({
      Bucket: bucket,
      Key: fullKey,
      Body: fs.createReadStream(tempFile)
    });

    const s3Uri = `s3://${bucket}/${fullKey}`;
    log.info(`uploaded ${s3Uri}`);

    return s3Uri;
  }

  /**
   * Download a remote file to disk
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} localPath - the full local destination file path
   */
  download(remotePath, localPath) { // eslint-disable-line no-unused-vars
    throw new TypeError('method not implemented');
  }

  /**
   * Write data to the server
   */
  write() {
    throw new TypeError('method not implemented');
  }
};
