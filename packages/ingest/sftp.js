'use strict';

const { Client } = require('ssh2');
const { PassThrough } = require('stream');
const { join } = require('path');
const { log, aws: { getS3Object, buildS3Uri, promiseS3Upload } } = require('@cumulus/common');
const get = require('lodash.get');
const omit = require('lodash.omit');

const { KMSProvider: KMS, DefaultProvider } = require('@cumulus/common/key-pair-provider');
const { lookupMimeType } = require('./util');
const recursion = require('./recursion');

module.exports.sftpMixin = (superclass) => class extends superclass {
  constructor(...args) {
    super(...args);
    this.connected = false; // use to indicate an active connection exists
    this.decrypted = false;
    this.options = {
      host: this.host,
      port: this.port || 22,
      user: this.username,
      password: this.password,
      privateKey: get(this.provider, 'privateKey', null),
      cmKeyId: get(this.provider, 'cmKeyId', null)
    };

    this.client = null;
    this.sftp = null;
  }

  async connect() {
    if (!this.decrypted && this.provider.encrypted) {
      if (this.password) {
        this.options.password = await DefaultProvider.decrypt(this.password);
        this.decrypted = true;
      }

      if (this.username) {
        this.options.user = await DefaultProvider.decrypt(this.username);
        this.decrypted = true;
      }
    }

    if (this.options.privateKey) {
      const bucket = process.env.system_bucket;
      const stackName = process.env.stackName;
      // we are assuming that the specified private key is in the S3 crypto directory
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

    const remoteUrl = `sftp://${this.host}/${remotePath}`;
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

    const input = Buffer.from(body);
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

  /**
   * get readable stream of the remote file
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @returns {Promise} readable stream of the remote file
   */
  async _getReadableStream(remotePath) {
    if (!this.connected) await this.connect();
    return new Promise((resolve, reject) => {
      const readStream = this.sftp.createReadStream(remotePath);
      readStream.on('error', reject);
      return resolve(readStream);
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
  async sync(remotePath, bucket, key) {
    const remoteUrl = `sftp://${this.host}/${remotePath}`;
    const s3uri = buildS3Uri(bucket, key);
    log.info(`Sync ${remoteUrl} to ${s3uri}`);

    const readable = await this._getReadableStream(remotePath);
    const pass = new PassThrough();
    readable.pipe(pass);

    const params = {
      Bucket: bucket,
      Key: key,
      Body: pass,
      ContentType: lookupMimeType(key)
    };

    const result = await promiseS3Upload(params);
    log.info('Uploading to s3 is complete(sftp)', result);
    return s3uri;
  }
};
