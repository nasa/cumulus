'use strict';

const { log, sftp: { Sftp } } = require('@cumulus/common');
const get = require('lodash.get');
const omit = require('lodash.omit');
const recursion = require('./recursion');

class SftpProviderClient {
  constructor(providerConfig) {
    this.id = providerConfig.id;
    this.host = providerConfig.host;

    this.sftpClient = new Sftp({
      host: this.host,
      port: providerConfig.port || 22,
      username: providerConfig.username,
      password: providerConfig.password,
      encrypted: providerConfig.encrypted,
      privateKey: get(providerConfig, 'privateKey', null),
      cmKeyId: get(providerConfig, 'cmKeyId', null)
    });
  }

  /**
   * Download a remote file to disk
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} localPath - the full local destination file path
   * @returns {Promise.<string>} - the path that the file was saved to
   */
  download(remotePath, localPath) {
    return this.sftpClient.download(remotePath, localPath);
  }

  /**
   * List all files from a given endpoint
   *
   * @param {string} path - the path to list
   * @returns {Promise}
   * @private
   */
  async list(path) {
    await this.sftpClient.connect();
    log.info(`SFTP Connected to ${this.host}`);

    try {
      const listFn = this.sftpClient.list.bind(this.sftpClient);
      const files = await recursion(listFn, path);
      log.info({ host: this.host }, `${files.length} files were found on ${this.host}`);

      // Type 'type' field is required to support recursive file listing, but
      // should not be part of the returned result.
      return files.map((file) => omit(file, 'type'));
    } finally {
      this.sftpClient.end();
    }
  }

  /**
   * Transfer the remote file to a given s3 location
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} bucket - destination s3 bucket of the file
   * @param {string} key - destination s3 key of the file
   * @returns {Promise} s3 uri of destination file
   */
  sync(remotePath, bucket, key) {
    return this.sftpClient.syncToS3(remotePath, bucket, key);
  }
}

module.exports = SftpProviderClient;
