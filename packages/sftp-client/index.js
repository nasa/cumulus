'use strict';

const get = require('lodash.get');
const KMS = require('@cumulus/aws-client/KMS');
const log = require('@cumulus/common/log');
const path = require('path');
const S3 = require('@cumulus/aws-client/S3');
const { Client } = require('ssh2');
const { lookupMimeType } = require('@cumulus/common/util');
const { PassThrough, Readable } = require('stream');
const { S3KeyPairProvider } = require('@cumulus/common/key-pair-provider');

const decrypt = async (ciphertext) => {
  try {
    return await KMS.decryptBase64String(ciphertext);
  } catch (_) {
    return S3KeyPairProvider.decrypt(ciphertext);
  }
};

class SftpClient {
  constructor(config) {
    this.config = config;
    this.connected = false;

    if (get(config, 'encrypted', false) === false) {
      this.plaintextUsername = config.username;
      this.plaintextPassword = config.password;
    }
  }

  async getUsername() {
    if (!this.plaintextUsername) {
      this.plaintextUsername = await decrypt(this.config.username);
    }

    return this.plaintextUsername;
  }

  async getPassword() {
    if (!this.plaintextPassword) {
      this.plaintextPassword = await decrypt(this.config.password);
    }

    return this.plaintextPassword;
  }

  async getPrivateKey() {
    // we are assuming that the specified private key is in the S3 crypto
    // directory
    const privateKey = await S3.getTextObject(
      process.env.system_bucket,
      `${process.env.stackName}/crypto/${this.config.privateKey}`
    );

    if (this.config.cmKeyId) {
      // we are using AWS KMS and the privateKey is encrypted
      return KMS.decryptBase64String(privateKey);
    }

    return privateKey;
  }

  async connect() {
    const clientOptions = {
      host: this.config.host,
      port: get(this.config, 'port', 22)
    };

    if (this.config.username) clientOptions.username = await this.getUsername();
    if (this.config.password) clientOptions.password = await this.getPassword();
    if (this.config.privateKey) {
      clientOptions.privateKey = await this.getPrivateKey();
    }

    return new Promise((resolve, reject) => {
      this.client = new Client();
      this.client.on('ready', () => {
        this.client.sftp((err, sftp) => {
          if (err) return reject(err);
          this.sftp = sftp;
          this.connected = true;
          return resolve();
        });
      });
      this.client.on('error', reject);
      this.client.connect(clientOptions);
    });
  }

  async end() {
    this.connected = false;
    if (this.client) await this.client.end();
  }

  /**
   * build remote url
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @returns {string} - remote url
   */
  buildRemoteUrl(remotePath) {
    return `sftp://${path.join(this.config.host, '/', remotePath)}`;
  }

  /**
   * Download a remote file to disk
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} localPath - the full local destination file path
   * @returns {Promise.<string>} - the local path that the file was saved to
   */
  async download(remotePath, localPath) {
    if (!this.connected) await this.connect();

    const remoteUrl = this.buildRemoteUrl(remotePath);
    log.info(`Downloading ${remoteUrl} to ${localPath}`);

    return new Promise((resolve, reject) => {
      this.sftp.fastGet(remotePath, localPath, (e) => {
        if (e) return reject(e);

        log.info(`Finishing downloading ${remoteUrl}`);
        return resolve(localPath);
      });
      this.client.on('error', (e) => reject(e));
    });
  }

  /**
   * Transfer the remote file to a given s3 location
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} bucket - destination s3 bucket of the file
   * @param {string} key - destination s3 key of the file
   * @returns {Promise} s3 uri of destination file
   */
  async syncToS3(remotePath, bucket, key) {
    const remoteUrl = this.buildRemoteUrl(remotePath);
    const s3uri = S3.buildS3Uri(bucket, key);
    log.info(`Sync ${remoteUrl} to ${s3uri}`);

    const readable = await this.getReadableStream(remotePath);
    const pass = new PassThrough();
    readable.pipe(pass);

    const params = {
      Bucket: bucket,
      Key: key,
      Body: pass,
      ContentType: lookupMimeType(key)
    };

    const result = await S3.promiseS3Upload(params);
    log.info('Downloading to s3 is complete(sftp)', result);
    return s3uri;
  }

  /**
   * List file in remote path
   *
   * @param {string} remotePath - the remote path to be listed
   * @returns {Promise.<Object>} - list of file object
   */
  async list(remotePath) {
    if (!this.connected) await this.connect();
    return new Promise((resolve, reject) => {
      this.sftp.readdir(remotePath, (err, list) => {
        if (err) {
          if (err.message.includes('No such file')) {
            return resolve([]);
          }
          return reject(err);
        }
        return resolve(list.map((i) => ({
          name: i.filename,
          path: remotePath,
          type: i.longname.substr(0, 1),
          size: i.attrs.size,
          time: i.attrs.mtime * 1000
        })));
      });
      this.client.on('error', (e) => reject(e));
    });
  }

  /**
   * get readable stream of the remote file
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @returns {Promise} readable stream of the remote file
   */
  async getReadableStream(remotePath) {
    if (!this.connected) await this.connect();
    return new Promise((resolve, reject) => {
      const readStream = this.sftp.createReadStream(remotePath);
      readStream.on('error', reject);
      this.client.on('error', (e) => reject(e));
      return resolve(readStream);
    });
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
    if (!this.connected) await this.connect();

    const s3uri = S3.buildS3Uri(s3object.Bucket, s3object.Key);
    if (!(await S3.s3ObjectExists(s3object))) {
      return Promise.reject(new Error(`Sftp.syncFromS3 ${s3uri} does not exist`));
    }

    const remoteUrl = this.buildRemoteUrl(remotePath);
    log.info(`Uploading ${s3uri} to ${remoteUrl}`);

    const readStream = await S3.getS3ObjectReadStream(s3object.Bucket, s3object.Key);
    return this.uploadFromStream(readStream, remotePath);
  }

  /**
   * Upload a data string to remote path
   *
   * @param {Object} data - data string
   * @param {string} remotePath - the full remote destination file path
   * @returns {Promise}
   */
  async uploadFromString(data, remotePath) {
    if (!this.connected) await this.connect();

    const readStream = new Readable();
    readStream.push(data);
    readStream.push(null);

    const remoteUrl = this.buildRemoteUrl(remotePath);
    log.info(`Uploading string to ${remoteUrl}`);
    return this.uploadFromStream(readStream, remotePath);
  }

  /**
   * Upload data from stream to a remote file
   *
   * @param {string} readStream - the stream content to be written to the file
   * @param {string} remotePath - the full remote destination file path
   * @returns {Promise}
   */
  async uploadFromStream(readStream, remotePath) {
    if (!this.connected) await this.connect();

    return new Promise((resolve, reject) => {
      const writeStream = this.sftp.createWriteStream(remotePath);
      writeStream.on('error', (e) => reject(e));
      readStream.on('error', (e) => reject(e));
      readStream.pipe(writeStream);
      writeStream.on('close', resolve);
      this.client.on('error', (e) => reject(e));
    });
  }
}

module.exports = SftpClient;
