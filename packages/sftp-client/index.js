'use strict';

const get = require('lodash/get');
const log = require('@cumulus/common/log');
const mime = require('mime-types');
const path = require('path');
const { s3 } = require('@cumulus/aws-client/services');
const S3 = require('@cumulus/aws-client/S3');
const Client = require('ssh2-sftp-client');

class SftpClient {
  constructor(config) {
    this.connected = false;

    this.clientOptions = {
      host: config.host,
      port: get(config, 'port', 22)
    };

    if (config.username) this.clientOptions.username = config.username;
    if (config.password) this.clientOptions.password = config.password;
    if (config.privateKey) this.clientOptions.privateKey = config.privateKey;

    this.sftpClient = new Client();
  }

  async connect() {
    if (this.connected) return;

    await this.sftpClient.connect(this.clientOptions);

    this.connected = true;
  }

  async end() {
    if (this.connected) {
      this.connected = false;

      await this.sftpClient.end();
    }
  }

  /* @private */
  get sftp() {
    if (!this.connected) {
      throw new Error('Client not connected');
    }

    return this.sftpClient;
  }

  /**
   * build remote url
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @returns {string} - remote url
   * @private
   */
  buildRemoteUrl(remotePath) {
    return `sftp://${path.join(this.clientOptions.host, '/', remotePath)}`;
  }

  /**
   * Download a remote file to disk
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} localPath - the full local destination file path
   * @returns {Promise<string>} - the local path that the file was saved to
   */
  async download(remotePath, localPath) {
    const remoteUrl = this.buildRemoteUrl(remotePath);

    log.info(`Downloading ${remoteUrl} to ${localPath}`);

    await this.sftp.fastGet(remotePath, localPath);

    log.info(`Finished downloading ${remoteUrl} to ${localPath}`);
  }

  async unlink(remotePath) {
    await this.sftp.delete(remotePath);
  }

  /**
   * Transfer the remote file to a given s3 location
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} bucket - destination s3 bucket of the file
   * @param {string} key - destination s3 key of the file
   * @returns {Promise.<{ s3uri: string, etag: string }>} an object containing
   *    the S3 URI and ETag of the destination file
   */
  async syncToS3(remotePath, bucket, key) {
    const remoteUrl = this.buildRemoteUrl(remotePath);

    const s3uri = S3.buildS3Uri(bucket, key);

    log.info(`Copying ${remoteUrl} to ${s3uri}`);

    // TODO Issue PR against ssh2-sftp-client to allow for getting a
    // readable stream back, rather than having to access the underlying
    // sftp object.
    const sftpReadStream = this.sftp.sftp.createReadStream(remotePath);

    const result = await S3.promiseS3Upload({
      Bucket: bucket,
      Key: key,
      Body: sftpReadStream,
      ContentType: mime.lookup(key) || undefined
    });

    log.info(`Finished copying ${remoteUrl} to ${s3uri}`);

    return { s3uri, etag: result.ETag };
  }

  /**
   * List file in remote path
   *
   * @param {string} remotePath - the remote path to be listed
   * @returns {Promise<Array<Object>>} list of file objects
   */
  async list(remotePath) {
    const remoteFiles = await this.sftp.list(remotePath);

    return remoteFiles.map((remoteFile) => ({
      name: remoteFile.name,
      path: remotePath,
      type: remoteFile.type,
      size: remoteFile.size,
      time: remoteFile.modifyTime
    }));
  }

  /**
   * Transfer an s3 file to remote path
   *
   * @param {Object} s3object
   * @param {string} s3object.Bucket - S3 bucket
   * @param {string} s3object.Key - S3 object key
   * @param {string} remotePath - the full remote destination file path
   * @returns {Promise}
   */
  async syncFromS3(s3object, remotePath) {
    const s3uri = S3.buildS3Uri(s3object.Bucket, s3object.Key);
    const remoteUrl = this.buildRemoteUrl(remotePath);

    log.info(`Copying ${s3uri} to ${remoteUrl}`);

    const readStream = await S3.getObjectReadStream({
      s3: s3(),
      bucket: s3object.Bucket,
      key: s3object.Key
    });

    await this.sftp.put(readStream, remotePath);

    log.info(`Finished copying ${s3uri} to ${remoteUrl}`);
  }
}

module.exports = SftpClient;
