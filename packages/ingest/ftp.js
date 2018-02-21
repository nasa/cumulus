'use strict';

const os = require('os');
const fs = require('fs');
const JSFtp = require('jsftp');
const join = require('path').join;
const log = require('@cumulus/common/log');
const aws = require('@cumulus/common/aws');
const Crypto = require('./crypto').DefaultProvider;
const recursion = require('./recursion');

module.exports.ftpMixin = superclass => class extends superclass {

  constructor(...args) {
    super(...args);
    this.decrypted = false;
    this.options = {
      host: this.host,
      port: this.port || 21,
      user: this.username || 'anonymous',
      pass: this.password || 'password'
    };

    this.connected = false;
    this.client = null;
  }

  async decrypt() {
    if (!this.decrypted && this.provider.encrypted) {
      if (this.password) {
        this.options.pass = await Crypto.decrypt(this.password);
        this.decrypted = true;
      }

      if (this.username) {
        this.options.user = await Crypto.decrypt(this.username);
        this.decrypted = true;
      }
    }
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

    await aws.s3().putObject({
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
    if (!this.decrypted) await this.decrypt();

    // let's stream to file
    const tempFile = join(os.tmpdir(), filename);
    const client = new JSFtp(this.options);

    return new Promise((resolve, reject) => {
      client.on('error', reject);
      client.get(join(path, filename), tempFile, (err) => {
        client.destroy();
        if (err) return reject(err);
        return resolve(tempFile);
      });
    });
  }

  /**
   * Downloads the file to disk, difference with sync is that
   * this method involves no uploading to S3
   * @return {Promise}
   * @private
   */

  async write(path, filename, body) {
    if (!this.decrypted) await this.decrypt();

    const client = new JSFtp(this.options);
    return new Promise((resolve, reject) => {
      client.on('error', reject);
      const input = new Buffer(body);
      client.put(input, join(path, filename), (err) => {
        client.destroy();
        if (err) return reject(err);
        return resolve();
      });
    });
  }

  async _list(path, _counter = 0) {
    if (!this.decrypted) await this.decrypt();
    let counter = _counter;
    const client = new JSFtp(this.options);
    return new Promise((resolve, reject) => {
      client.on('error', reject);
      client.ls(path, (err, data) => {
        client.destroy();
        if (err) {
          if (err.message.includes('Timed out') && counter < 3) {
            log.error(`Connection timed out while listing ${path}. Retrying...`);
            counter += 1;
            return this._list(path, counter).then((r) => {
              log.info(`${counter} retry suceeded`);
              return resolve(r);
            }).catch(e => reject(e));
          }
          return reject(err);
        }

        return resolve(data.map(d => ({
          name: d.name,
          type: d.type,
          size: d.size,
          time: d.date,
          owner: d.owner,
          group: d.group,
          path: path
        })));
      });
    });
  }

  /**
   * List all PDR files from a given endpoint
   * @return {Promise}
   * @private
   */

  async list() {
    if (!this.decrypted) await this.decrypt();

    const listFn = this._list.bind(this);
    const files = await recursion(listFn, this.path);
    log.info(`${files.length} files were found on ${this.host}`);
    return files;
  }
};
