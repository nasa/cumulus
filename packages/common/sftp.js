'use strict';

const { Client } = require('ssh2');
const { PassThrough, Readable } = require('stream');
const { lookupMimeType } = require('./util');
const log = require('./log');
const {
  buildS3Uri, getS3Object, getS3ObjectReadStream, promiseS3Upload, s3ObjectExists
} = require('./aws');

const { KMSProvider: KMS, DefaultProvider } = require('./key-pair-provider');

class Sftp {
  constructor(config) {
    // use to indicate an active connection exists
    this.connected = false;
    // indicate username and password have been decrypted in options
    this.decrypted = false;
    // indicate username and password provided are encrypted
    this.encrypted = config.encrypted || false;
    this.username = config.username;
    this.password = config.password;
    this.options = {
      host: config.host,
      port: config.port || 22,
      username: config.username,
      password: config.password,
      privateKey: config.privateKey,
      cmKeyId: config.cmKeyId
    };

    this.client = null;
    this.sftp = null;
  }

  async connect() {
    if (!this.decrypted && this.encrypted) {
      if (this.password) {
        this.options.password = await DefaultProvider.decrypt(this.password);
      }

      if (this.username) {
        this.options.username = await DefaultProvider.decrypt(this.username);
      }
      this.decrypted = true;
    }

    if (this.options.privateKey) {
      const bucket = process.env.system_bucket;
      const stackName = process.env.stackName;
      // we are assuming that the specified private key is in the S3 crypto directory
      const keyExists = await s3ObjectExists(
        { Bucket: bucket, Key: `${stackName}/crypto/${this.options.privateKey}` }
      );
      if (!keyExists) {
        return Promise.reject(new Error(`${this.options.privateKey} does not exist in S3 crypto directory`));
      }

      log.debug(`Reading Key: ${this.options.privateKey} bucket:${bucket},stack:${stackName}`);
      const priv = await getS3Object(bucket, `${stackName}/crypto/${this.options.privateKey}`);

      if (this.options.cmKeyId) {
        // we are using AWS KMS and the privateKey is encrypted
        this.options.privateKey = await KMS.decrypt(priv.Body.toString());
      } else {
        // private key is not encrypted...
        this.options.privateKey = priv.Body.toString();
      }
    }

    return new Promise((resolve, reject) => {
      this.client = new Client();
      this.client.on('ready', () => {
        this.client.sftp((err, sftp) => {
          if (err) return reject(err);
          this.sftp = sftp;
          this.connected = true;
          log.info(`SFTP Connected to ${this.options.host}`);
          return resolve();
        });
      });
      this.client.on('error', (e) => reject(e));
      this.client.connect(this.options);
    });
  }

  async end() {
    this.connected = false;
    if (this.client) await this.client.end();
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

    const remoteUrl = `sftp://${this.options.host}/${remotePath}`;
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
   * Download the remote file to a given s3 location
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} bucket - destination s3 bucket of the file
   * @param {string} key - destination s3 key of the file
   * @returns {Promise} s3 uri of destination file
   */
  async downloadToS3(remotePath, bucket, key) {
    const remoteUrl = `sftp://${this.host}/${remotePath}`;
    const s3uri = buildS3Uri(bucket, key);
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

    const result = await promiseS3Upload(params);
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
   * Upload a s3 file to remote path
   *
   * @param {Object} s3object
   * @param {string} s3object.Bucket - S3 bucket
   * @param {string} s3object.Key - S3 object key
   * @param {string} remotePath - the full remote destination file path
   * @returns {Promise}
   */
  async uploadFromS3(s3object, remotePath) {
    if (!this.connected) await this.connect();

    const s3uri = buildS3Uri(s3object.Bucket, s3object.Key);
    if (!(await s3ObjectExists(s3object))) {
      return Promise.reject(new Error(`Sftp.uploadFromS3 ${s3uri} does not exist`));
    }

    const remoteUrl = `sftp://${this.options.host}/${remotePath}`;
    log.info(`Uploading ${s3uri} to ${remoteUrl}`);

    const readStream = await getS3ObjectReadStream(s3object.Bucket, s3object.Key);
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

    const remoteUrl = `sftp://${this.options.host}/${remotePath}`;
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

exports.Sftp = Sftp;
