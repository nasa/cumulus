'use strict';

const fs = require('fs');
const os = require('os');
const Client = require('ssh2').Client;
const join = require('path').join;
const log = require('@cumulus/common/log');
const Crypto = require('./crypto').DefaultProvider;
const recursion = require('./recursion');

const { s3 } = require('@cumulus/common/aws');
const { omit } = require('lodash');

//const PathIsInvalid = errors.createErrorType('PathIsInvalid');

module.exports = superclass => class extends superclass {

  constructor(...args) {
    super(...args);
    this.connected = false; // use to indicate an active connection exists
    this.decrypted = false;
    this.options = {
      host: this.host,
      port: this.port || 22,
      user: this.username,
      password: this.password
    };

    this.client = null;
    this.sftp = null;
  }

  async connect() {
    if (!this.decrypted && this.provider.encrypted) {
      if (this.password) {
        this.options.password = await Crypto.decrypt(this.password);
        this.decrypted = true;
      }

      if (this.username) {
        this.options.user = await Crypto.decrypt(this.username);
        this.decrypted = true;
      }
    }

    return new Promise((resolve, reject) => {
      this.client = new Client();
      this.client.on('ready', () => {
        this.client.sftp((err, sftp) => {
          if (err) return reject(err);
          this.sftp = sftp;
          this.connected = true;
          log.info({ provider: this.provider.id }, `SFTP Connected to ${this.host}`);
          return resolve();
        });
      });
      this.client.on('error', (e) => reject(e));
      this.client.connect(this.options);
    });
  }

  async end() {
    return this.client.end();
  }

  /**
   * Downloads a given url and upload to a given S3 location
   * @return {Promise}
   * @private
   */

  async sync(path, bucket, key, filename) {
    const tempFile = await this.download(path, filename);
    return this.upload(bucket, key, filename, tempFile);
  }

  /**
   * Upload a file to S3
   *
   * @param {string} bucket - the S3 bucket to upload to
   * @param {string} key - the base path of the S3 key
   * @param {string} filename - the filename to be uploaded to
   * @param {string} tempFile - the location of the file to be uploaded
   * @returns {Promise.<string>} - the S3 URL that the file was uploaded to
   */
  async upload(bucket, key, filename, tempFile) {
    const fullKey = join(key, filename);

    await s3().putObject({
      Bucket: bucket,
      Key: fullKey,
      Body: fs.createReadStream(tempFile)
    }).promise();

    log.info(`uploaded ${filename} to ${bucket}`);
    return `s3://${bucket}/${fullKey}`;
  }

  /**
   * Downloads the file to disk, difference with sync is that
   * this method involves no uploading to S3
   * @return {Promise}
   * @private
   */

  async download(path, filename) {
    // let's stream to file
    if (!this.connected) await this.connect();

    const tempFile = join(os.tmpdir(), filename);
    const remoteFile = join(path, filename);
    log.info({ filename }, `Downloading to ${tempFile}`);

    return new Promise((resolve, reject) => {
      this.sftp.fastGet(remoteFile, tempFile, (e) => {
        if (e) return reject(e);
        log.info({ filename }, `Finishing downloading ${path}`);
        return resolve(tempFile);
      });
      this.client.on('error', reject);
    });
  }

  /**
   * Downloads the file to disk, difference with sync is that
   * this method involves no uploading to S3
   * @return {Promise}
   * @private
   */

  async write(host, path, filename, body) {
    // stream to file
    if (!this.connected) await this.connect();

    const input = new Buffer(body);
    return new Promise((resolve, reject) => {
      const stream = this.sftp.createWriteStream(join(path, filename));
      stream.on('error', reject);
      stream.on('close', resolve);
      stream.end(input);
    });
  }

  async _list(path) {
    if (!this.connected) await this.connect();

    return new Promise((resolve, reject) => {
      this.sftp.readdir(path, (err, list) => {
        if (err) {
          if (err.message.includes('No such file')) {
            return resolve([]);
          }
          return reject(err);
        }
        return resolve(list.map((i) => ({
          name: i.filename,
          path: path,
          type: i.longname.substr(0, 1),
          size: i.attrs.size,
          time: i.attrs.mtime * 1000
        })));
      });
    });
  }

  /**
   * List all files from a given endpoint
   * @return {Promise}
   * @private
   */

  async list() {
    const listFn = this._list.bind(this);
    const files = await recursion(listFn, this.path);
    log.info({ host: this.host }, `${files.length} files were found on ${this.host}`);

    // Type 'type' field is required to support recursive file listing, but
    // should not be part of the returned result.
    return files.map((file) => omit(file, 'type'));
  }
};
