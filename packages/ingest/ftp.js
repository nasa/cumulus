'use strict';

const mime = require('mime-types');
const JSFtp = require('jsftp');
const join = require('path').join;
const { PassThrough } = require('stream');
const { log, aws: { buildS3Uri, promiseS3Upload } } = require('@cumulus/common');
const omit = require('lodash.omit');

const { DefaultProvider } = require('@cumulus/common/key-pair-provider');
const recursion = require('./recursion');

module.exports.ftpMixin = (superclass) => class extends superclass {
  // jsftp.ls is called in _list and uses 'STAT' as a default. Some FTP
  // servers return inconsistent results when using
  // 'STAT' command. We can use 'LIST' in those cases by
  // setting the variable `useList` to true
  constructor(...args) {
    super(...args);
    this.decrypted = false;
    this.ftpClientOptions = {
      host: this.host,
      port: this.port || 21,
      user: this.username || 'anonymous',
      pass: this.password || 'password',
      useList: this.useList || false
    };

    this.connected = false;
    this.client = null;
  }

  async decrypt() {
    if (!this.decrypted && this.provider.encrypted) {
      if (this.password) {
        this.ftpClientOptions.pass = await DefaultProvider.decrypt(this.password);
        this.decrypted = true;
      }

      if (this.username) {
        this.ftpClientOptions.user = await DefaultProvider.decrypt(this.username);
        this.decrypted = true;
      }
    }
  }

  /**
   * Download a remote file to disk
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} localPath - the full local destination file path
   * @returns {Promise.<string>} - the path that the file was saved to
   */
  async download(remotePath, localPath) {
    const remoteUrl = `ftp://${this.host}/${remotePath}`;
    log.info(`Downloading ${remoteUrl} to ${localPath}`);

    if (!this.decrypted) await this.decrypt();

    const client = new JSFtp(this.ftpClientOptions);

    return new Promise((resolve, reject) => {
      client.on('error', reject);
      client.get(remotePath, localPath, (err) => {
        client.destroy();

        if (err) reject(err);
        else {
          log.info(`Finishing downloading ${remoteUrl}`);
          resolve(localPath);
        }
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

    const client = new JSFtp(this.ftpClientOptions);
    return new Promise((resolve, reject) => {
      client.on('error', reject);
      const input = Buffer.from(body);
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
    const client = new JSFtp(this.ftpClientOptions);
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
            }).catch((e) => reject(e));
          }
          return reject(err);
        }

        return resolve(data.map((d) => ({
          name: d.name,
          path: path,
          size: parseInt(d.size, 10),
          time: d.time,
          type: d.type
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

    // Type 'type' field is required to support recursive file listing, but
    // should not be part of the returned result.
    return files.map((file) => omit(file, 'type'));
  }

  /**
   * Download the remote file to a given s3 location
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} bucket - destination s3 bucket of the file
   * @param {string} key - destination s3 key of the file
   * @returns {Promise} s3 uri of destination file
   */
  async sync(remotePath, bucket, key) {
    const remoteUrl = `ftp://${this.host}/${remotePath}`;
    const s3uri = buildS3Uri(bucket, key);
    log.info(`Sync ${remoteUrl} to ${s3uri}`);

    if (!this.decrypted) await this.decrypt();
    const client = new JSFtp(this.ftpClientOptions);

    // get readable stream for remote file
    const readable = await new Promise((resolve, reject) => {
      client.get(remotePath, (err, socket) => {
        if (err) {
          client.destroy();
          return reject(err);
        }
        return resolve(socket);
      });
    });

    const pass = new PassThrough();
    readable.pipe(pass);

    const params = {
      Bucket: bucket,
      Key: key,
      Body: pass,
      ContentType: mime.lookup(key) || null
    };
    await promiseS3Upload(params);
    log.info('Uploading to s3 is complete(ftp)', s3uri);

    client.destroy();

    return s3uri;
  }
};
