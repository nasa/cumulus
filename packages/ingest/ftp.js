'use strict';

const fs = require('fs');
const os = require('os');
const Client = require('ftp');
const join = require('path').join;
const urljoin = require('url-join');
const FTPError = require('@cumulus/common/errors').FTPError;
const S3 = require('./aws').S3;

module.exports.ftpMixin = superclass => class extends superclass {

  constructor(...args) {
    super(...args);
    this.ftpOptions = {
      host: this.host,
      port: this.port || 21,
      user: this.username,
      password: this.password,
      keepalive: 1200
    };
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
    const tempFile = join(os.tmpdir(), filename);
    const file = fs.createWriteStream(tempFile);

    const ftpClient = new Client();

    return new Promise((resolve, reject) => {
      ftpClient.on('error', (err) => {
        const e = {
          message: `FTP download failed for ${host}: ${err.message}`,
          details: err
        };
        ftpClient.destroy();
        return reject(e);
      });

      ftpClient.on('ready', () => {
        ftpClient.get(join(path, filename), (err, stream) => {
          // exit if there are errors
          if (err) {
            return reject(err);
          }

          stream.on('data', chunk => file.write(chunk));
          stream.on('error', e => reject(e));
          return stream.on('end', () => {
            file.close();
            ftpClient.end();
            resolve(tempFile);
          });
        });
      });

      ftpClient.connect(this.ftpOptions);
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
    const ftpClient = new Client();

    return new Promise((resolve, reject) => {
      ftpClient.on('error', (err) => {
        const e = {
          message: `FTP write failed for ${host}: ${err.message}`,
          details: err
        };
        ftpClient.destroy();
        return reject(e);
      });

      ftpClient.on('ready', () => {
        const input = new Buffer(body);
        ftpClient.put(input, join(path, filename), (err) => {
          // exit if there are errors
          if (err) {
            return reject(err);
          }
          ftpClient.end();
          return resolve();
        });
      });

      ftpClient.connect(this.ftpOptions);
    });
  }

  /**
   * List all PDR files from a given endpoint
   * @return {Promise}
   * @private
   */

  _list() {
    const pattern = new RegExp(/(.*PDR)$/);
    const ftpClient = new Client();

    return new Promise((resolve, reject) => {
      ftpClient.on('error', (err) => {
        ftpClient.destroy();
        const error = new FTPError(err.message);
        return reject(error);
      });

      ftpClient.on('ready', () => {
        ftpClient.list(this.path, (err, list) => {
          // close the connection
          ftpClient.end();

          // exit if there are errors
          if (err) {
            return reject(err);
          }

          // iterate through results and select PDR files
          this.pdrs = list.filter((item) => {
            if (item.type === '-') {
              if (item.name.match(pattern)) {
                return true;
              }
            }
            return false;
          }).map(item => item.name);

          return resolve(this.pdrs);
        });
      });

      ftpClient.connect(this.ftpOptions);
    });
  }
};
