'use strict';

const fs = require('fs');
const os = require('os');
const Client = require('ssh2').Client;
const join = require('path').join;
const urljoin = require('url-join');
const log = require('@cumulus/common/log');
//const errors = require('@cumulus/common/errors');
const S3 = require('./aws').S3;
const Crypto = require('./crypto').DefaultProvider;
const recursion = require('./recursion');

//const PathIsInvalid = errors.createErrorType('PathIsInvalid');

module.exports = superclass => class extends superclass {

  constructor(...args) {
    super(...args);
    this.connected = false; // use to indicate an active connection exists
    this.decrypted = false;
    this.options = {
      host: this.host,
      port: this.port || 21,
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
    }

    return new Promise((resolve, reject) => {
      this.client = new Client();
      this.client.on('ready', () => {
        this.client.sftp((err, sftp) => {
          if (err) return reject(err);
          this.sftp = sftp;
          this.connected = true;
          log.info(`SFTP Connected to ${this.host}`);
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

  async upload(bucket, key, filename, tempFile) {
    await S3.upload(bucket, join(key, filename), fs.createReadStream(tempFile));
    return urljoin('s3://', bucket, key, filename);
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
    log.info(`Downloading to ${tempFile}`);

    return new Promise((resolve, reject) => {
      this.sftp.fastGet(remoteFile, tempFile, (e) => {
        if (e) return reject(e);
        log.info(`Finishing downloading ${this.filename}`);
        return (resolve(tempFile));
      });
      this.client.on('error', (e) => reject(e));
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
        return resolve(list.map(i => ({
          name: i.filename,
          type: i.longname.substr(0, 1),
          size: i.attrs.size,
          time: i.attrs.mtime,
          owner: i.attrs.uid,
          group: i.attrs.gid,
          path: path
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
    log.info(`${files.length} files were found on ${this.host}`);
    return files;
  }
};
