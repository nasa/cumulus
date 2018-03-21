'use strict';

const Client = require('ssh2').Client;
const join = require('path').join;
const log = require('@cumulus/common/log');
const Crypto = require('./crypto').DefaultProvider;
const recursion = require('./recursion');

const { omit } = require('lodash');

module.exports = (superclass) => class extends superclass {

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
   * Download a remote file to disk
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} localPath - the full local destination file path
   * @returns {Promise.<string>} - the path that the file was saved to
   */
  async download(remotePath, localPath) {
    if (!this.connected) await this.connect();

    const remoteUrl = `sftp://${this.host}${remotePath}`;
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
