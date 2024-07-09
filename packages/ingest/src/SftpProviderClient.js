//@ts-check
'use strict';

const get = require('lodash/get');
const KMS = require('@cumulus/aws-client/KMS');
const log = require('@cumulus/common/log');
const omit = require('lodash/omit');
const S3 = require('@cumulus/aws-client/S3');
const { SftpClient } = require('@cumulus/sftp-client');
const isNil = require('lodash/isNil');
const { recursion } = require('./recursion');
const { decrypt } = require('./util');

class SftpProviderClient {
  constructor(providerConfig) {
    this.providerConfig = providerConfig;

    if (get(providerConfig, 'encrypted', false) === false) {
      this.plaintextUsername = providerConfig.username;
      this.plaintextPassword = providerConfig.password;
      this.plaintextPrivateKey = providerConfig.plaintextProviderKey;
    }

    this.connected = false;
    this.privateSftpClient = undefined;
  }

  async connect() {
    if (this.connected) return;

    this.privateSftpClient = new SftpClient({
      host: this.host,
      port: get(this.providerConfig, 'port', 22),
      username: await this.getUsername(),
      password: await this.getPassword(),
      privateKey: await this.getPrivateKey(),
    });

    await this.privateSftpClient.connect(this.clientOptions);

    this.connected = true;
  }

  async end() {
    if (this.connected) {
      await this.privateSftpClient.end();

      this.connected = false;
    }
  }

  /* @private */
  get host() {
    return this.providerConfig.host;
  }

  /* @private */
  async getUsername() {
    if (isNil(this.providerConfig.username)) return undefined;

    if (isNil(this.plaintextUsername)) {
      this.plaintextUsername = await decrypt(this.providerConfig.username);
    }

    return this.plaintextUsername;
  }

  /* @private */
  async getPassword() {
    if (isNil(this.providerConfig.password)) return undefined;

    if (isNil(this.plaintextPassword)) {
      this.plaintextPassword = await decrypt(this.providerConfig.password);
    }

    return this.plaintextPassword;
  }

  /* @private */
  async getPrivateKey() {
    if (isNil(this.providerConfig.privateKey)) return undefined;

    if (isNil(this.plaintextProviderKey)) {
      // we are assuming that the specified private key is in the S3 crypto
      // directory
      const fetchedKey = await S3.getTextObject(
        process.env.system_bucket,
        `${process.env.stackName}/crypto/${this.providerConfig.privateKey}`
      );

      if (this.providerConfig.cmKeyId) {
        // we are using AWS KMS and the privateKey is encrypted
        this.plaintextProviderKey = KMS.decryptBase64String(fetchedKey);
      } else {
        this.plaintextProviderKey = fetchedKey;
      }
    }

    return this.plaintextProviderKey;
  }

  /* @private */
  getSftpClient() {
    if (!this.connected) {
      throw new Error('Client not connected');
    }

    return this.privateSftpClient;
  }

  /**
   * Download a remote file to disk
   * @param {Object} params             - parameter object
   * @param {string} params.remotePath  - the full path to the remote file to be fetched
   * @param {string} params.localPath   - the full local destination file path
   * @returns {Promise<string>}        - the path that the file was saved to
   */
  async download(params) {
    const { remotePath, localPath } = params;
    return await this.getSftpClient().download(remotePath, localPath);
  }

  /**
   * List all files from a given endpoint
   *
   * @param {string} path - the path to list
   * @returns {Promise}
   */
  async list(path) {
    const sftpClient = this.getSftpClient();
    const listFn = sftpClient.list.bind(sftpClient);
    const files = await recursion(listFn, path);
    log.info({ host: this.host }, `${files.length} files were found on ${this.host}`);

    // Type 'type' field is required to support recursive file listing, but
    // should not be part of the returned result.
    return files.map((file) => omit(file, 'type'));
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
  async sync(params) {
    const remotePath = params.fileRemotePath;
    const bucket = params.destinationBucket;
    const key = params.destinationKey;
    return await this.getSftpClient().syncToS3(remotePath, bucket, key);
  }
}

module.exports = SftpProviderClient;
