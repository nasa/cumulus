'use strict';

const os = require('os');
const fs = require('fs');
const Ftp = require('ftp');
const join = require('path').join;
const urljoin = require('url-join');
const log = require('@cumulus/common/log');
const FTPError = require('@cumulus/common/errors').FTPError;
const S3 = require('./aws').S3;
const Crypto = require('./crypto').DefaultProvider;
const recursion = require('./recursion');

module.exports.ftpMixin = superclass => class extends superclass {

  constructor(...args) {
    super(...args);
    this.decrypted = false;
    this.options = {
      host: this.host,
      port: this.port || 21,
      user: this.username,
      password: this.password,
      keepalive: 500, // every 1/2 second
      pasvTimeout: 2000 // 5 mins
    };

    this.connected = false;
    this.client = null;
  }

  async connect() {
    this.client = new Ftp();

    if (!this.decrypted && this.provider.encrypted) {
      if (this.password) {
        this.options.password = await Crypto.decrypt(this.password);
        this.decrypted = true;
      }
    }

    return new Promise((resolve, reject) => {
      this.client.connect(this.options);
      this.client.on('ready', () => {
        this.connected = true;
        return resolve();
      });
      this.client.on('error', (e) => {
        if (e.message.includes('Login incorrect')) {
          return reject(new FTPError('Login incorrect'));
        }
        return reject(e);
      });
    });
  }

  end() {
    this.client.end();
    this.connected = false;
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
    if (!this.connected) await this.connect();

    // let's stream to file
    const tempFile = join(os.tmpdir(), filename);
    const file = fs.createWriteStream(tempFile);

    return new Promise((resolve, reject) => {
      this.client.get(join(path, filename), (err, stream) => {
        // exit if there are errors
        if (err) {
          return reject(err);
        }

        stream.on('data', chunk => file.write(chunk));
        stream.on('error', e => reject(e));
        return stream.on('end', () => {
          file.close();
          resolve(tempFile);
        });
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
    if (!this.connected) await this.connect();

    return new Promise((resolve, reject) => {
      const input = new Buffer(body);
      this.client.put(input, join(path, filename), (err) => {
        // exit if there are errors
        if (err) {
          return reject(err);
        }
        return resolve();
      });
    });
  }

  async _list(path, _counter = 0) {
    let counter = _counter;
    return new Promise((resolve, reject) => {
      this.client.list(path, false, (err, data) => {
        if (err) {
          if (err.message.includes('Timed out') && counter < 3) {
            log.error(`Connection timed out while listing ${path}. Retrying...`);
            this.end();
            return this.connect().then(() => {
              counter += 1;
              return this._list(path, counter);
            }).then((r) => {
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
    if (!this.connected) await this.connect();

    const listFn = this._list.bind(this);
    const files = await recursion(listFn, this.path);
    log.info(`${files.length} files were found on ${this.host}`);
    return files;
  }
};
