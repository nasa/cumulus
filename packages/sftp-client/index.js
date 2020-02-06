'use strict';

const get = require('lodash.get');
const log = require('@cumulus/common/log');
const path = require('path');
const S3 = require('@cumulus/aws-client/S3');
const { Client } = require('ssh2');
const { lookupMimeType } = require('@cumulus/common/util');
const { PassThrough } = require('stream');

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
  }

  /**
   * @private
   */
  async connect() {
    if (this.connected) return;

    await new Promise((resolve, reject) => {
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

      this.client.connect(this.clientOptions);
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
    await this.connect();

    const remoteUrl = this.buildRemoteUrl(remotePath);
    log.info(`Downloading ${remoteUrl} to ${localPath}`);

    return new Promise((resolve, reject) => {
      this.sftp.fastGet(remotePath, localPath, (e) => {
        if (e) return reject(e);

        log.info(`Finishing downloading ${remoteUrl}`);
        return resolve(localPath);
      });

      this.client.on('error', reject);
    });
  }

  async unlink(remotePath) {
    await this.connect();

    return new Promise((resolve, reject) => {
      this.sftp.unlink(remotePath, (error) => {
        if (error) reject(error);
        else resolve();
      });
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
   * @returns {Promise<Array<Object>>} list of file objects
   */
  async list(remotePath) {
    await this.connect();

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
      this.client.on('error', reject);
    });
  }

  /**
   * get readable stream of the remote file
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @returns {Promise} readable stream of the remote file
   * @private
   */
  async getReadableStream(remotePath) {
    await this.connect();

    return new Promise((resolve, reject) => {
      const readStream = this.sftp.createReadStream(remotePath);
      readStream.on('error', reject);
      this.client.on('error', reject);
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
    await this.connect();

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
   * Upload data from stream to a remote file
   *
   * @param {string} readStream - the stream content to be written to the file
   * @param {string} remotePath - the full remote destination file path
   * @returns {Promise}
   * @private
   */
  async uploadFromStream(readStream, remotePath) {
    await this.connect();

    return new Promise((resolve, reject) => {
      const writeStream = this.sftp.createWriteStream(remotePath);
      writeStream.on('error', reject);
      readStream.on('error', reject);
      readStream.pipe(writeStream);
      writeStream.on('close', resolve);
      this.client.on('error', reject);
    });
  }
}

module.exports = SftpClient;
