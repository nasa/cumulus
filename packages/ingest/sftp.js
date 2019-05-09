'use strict';

const { join } = require('path');
const { log, sftp: { Sftp } } = require('@cumulus/common');
const get = require('lodash.get');
const omit = require('lodash.omit');
const recursion = require('./recursion');

module.exports.sftpMixin = (superclass) => class extends superclass {
  constructor(...args) {
    super(...args);
    const sftpConfig = {
      host: this.host,
      port: this.port || 22,
      username: this.username,
      password: this.password,
      encrypted: this.provider.encrypted,
      privateKey: get(this.provider, 'privateKey', null),
      cmKeyId: get(this.provider, 'cmKeyId', null)
    };
    this.sftpClient = new Sftp(sftpConfig);
  }

  async connect() {
    return this.sftpClient.connect().then(() =>
      log.info({ provider: this.provider.id }, `SFTP Connected to ${this.host}`));
  }

  async end() {
    return this.sftpClient.end();
  }

  /**
   * Download a remote file to disk
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} localPath - the full local destination file path
   * @returns {Promise.<string>} - the path that the file was saved to
   */
  async download(remotePath, localPath) {
    return this.sftpClient.download(remotePath, localPath);
  }

  /**
   * Write stream to a remote file
   *
   * @param {string} remotePath - the remote directory path that file will be saved to
   * @param {string} filename - the remote file name
   * @param {string} body - the content to be written to the file
   * @returns {Promise}
   */
  async write(remotePath, filename, body) {
    const fullPath = join(remotePath, filename);
    return this.sftpClient.uploadFromString(body, fullPath);
  }

  /**
   * List all files from a given endpoint
   * @return {Promise}
   * @private
   */

  async list() {
    const listFn = this.sftpClient.list.bind(this.sftpClient);
    const files = await recursion(listFn, this.path);
    log.info({ host: this.host }, `${files.length} files were found on ${this.host}`);

    // Type 'type' field is required to support recursive file listing, but
    // should not be part of the returned result.
    return files.map((file) => omit(file, 'type'));
  }

  /**
   * Download the remote file to a given s3 location
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} bucket - destination s3 bucket of the file
   * @param {string} key - destination s3 key of the file
   * @returns {Promise} s3 uri of destination file
   */
  async sync(remotePath, bucket, key) {
    return this.sftpClient.downloadToS3(remotePath, bucket, key);
  }
};
