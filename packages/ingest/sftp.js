'use strict';

const fs = require('fs');
const os = require('os');
const Client = require('ssh2-sftp-client');
const join = require('path').join;
const urljoin = require('url-join');
const errors = require('@cumulus/common/errors');
const S3 = require('./aws').S3;

const PathIsInvalid = errors.createErrorType('PathIsInvalid');

module.exports = superclass => class extends superclass {

  constructor(...args) {
    super(...args);
    this.options = {
      host: this.host,
      port: this.port || 21,
      user: this.username,
      password: this.password
    };

    const regex = /(\(.*?\))/g;
    this.recursion = this.path.split(regex).map(i => i.replace(/\\\\/g, '\\'));
    this.map = this.recursion.map(r => (r.match(regex) !== null));
    this.client = null;
  }

  async _connect() {
    this.client = new Client();
    await this.client.connect(this.options);
  }

  async _end() {
    return this.client.end();
  }

  /**
   * Downloads a given url and upload to a given S3 location
   * @return {Promise}
   * @private
   */

  async _sync(url, bucket, key, filename) {
    const tempFile = await this._download(this.host, this.path, filename);
    await S3.upload(bucket, join(key, filename), fs.createReadStream(tempFile));
    return urljoin('s3://', bucket, key, filename);
  }

  /**
   * Downloads the file to disk, difference with sync is that
   * this method involves no uploading to S3
   * @return {Promise}
   * @private
   */

  async _download(host, path, filename) {
    // let's stream to file
    if (!this.client) await this._connect();

    const tempFile = join(os.tmpdir(), filename);
    const file = fs.createWriteStream(tempFile);
    const stream = await this.client.get(join(path, filename));

    return new Promise((resolve, reject) => {
      stream.on('data', chunk => file.write(chunk));
      stream.on('error', e => reject(e));
      return stream.on('end', () => {
        file.close();
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

  async _write(host, path, filename, body) {
    // stream to file
    if (!this.client) await this._connect();

    const input = new Buffer(body);
    await this.client.put(input, join(path, filename));
  }

  /**
   * List all files from a given endpoint
   * @return {Promise}
   * @private
   */

  async _list(_start = null, position = 0) {
    let start = _start;
    if (!start) {
      start = this.recursion[position];
    }

    let allFiles = {};
    try {
      if (!this.client) await this._connect();

      const list = await this.client.list(start);
      allFiles[start] = [];
      for (const item of list) {
        if (item.type === 'd') {
          const isRegex = this.map[position + 1];
          let regexPath;
          let textPath;
          if (isRegex) {
            regexPath = new RegExp(this.recursion[position + 1]);
          }
          else {
            textPath = this.recursion[position + 1];
          }
          if (isRegex && item.name.match(regexPath)) {
            const newStart = join(start, item.name);
            const tmp = await this._list(newStart, position + 1);
            allFiles = Object.assign(tmp, allFiles);
          }
          else {
            const newStart = join(start, textPath);
            const tmp = await this._list(newStart, position + 1);
            allFiles = Object.assign(tmp, allFiles);
          }
        }
        else if (item.type === '-') {
          allFiles[start].push(item);
        }
      }

      return allFiles;
    }
    catch (e) {
      if (e.message.includes('No such file')) {
        return allFiles;
      }
      await this._end();
      throw e;
    }
  }
};
