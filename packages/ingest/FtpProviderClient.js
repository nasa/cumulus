'use strict';

const get = require('lodash.get');
const JSFtp = require('jsftp');
const KMS = require('@cumulus/aws-client/KMS');
const { PassThrough } = require('stream');
const log = require('@cumulus/common/log');
const omit = require('lodash.omit');
const S3 = require('@cumulus/aws-client/S3');
const { S3KeyPairProvider } = require('@cumulus/common/key-pair-provider');
const recursion = require('./recursion');
const { lookupMimeType } = require('./util');

const decrypt = async (ciphertext) => {
  try {
    return await KMS.decryptBase64String(ciphertext);
  } catch (_) {
    return S3KeyPairProvider.decrypt(ciphertext);
  }
};

class FtpProviderClient {
  // jsftp.ls is called in _list and uses 'STAT' as a default. Some FTP
  // servers return inconsistent results when using
  // 'STAT' command. We can use 'LIST' in those cases by
  // setting the variable `useList` to true
  constructor(providerConfig) {
    this.providerConfig = providerConfig;
    this.host = providerConfig.host;

    if (get(providerConfig, 'encrypted', false) === false) {
      this.plaintextUsername = get(providerConfig, 'username', 'anonymous');
      this.plaintextPassword = get(providerConfig, 'password', 'password');
    }
  }

  async getUsername() {
    if (!this.plaintextUsername) {
      this.plaintextUsername = await decrypt(this.providerConfig.username);
    }

    return this.plaintextUsername;
  }

  async getPassword() {
    if (!this.plaintextPassword) {
      this.plaintextPassword = await decrypt(this.providerConfig.password);
    }

    return this.plaintextPassword;
  }

  async buildFtpClient() {
    return new JSFtp({
      host: this.host,
      port: get(this.providerConfig, 'port', 21),
      user: await this.getUsername(),
      pass: await this.getPassword(),
      useList: get(this.providerConfig, 'useList', false)
    });
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

    const client = await this.buildFtpClient();

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

  async _list(path, _counter = 0) {
    let counter = _counter;
    const client = await this.buildFtpClient();
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

  async list(path) {
    const listFn = this._list.bind(this);
    const files = await recursion(listFn, path);

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
    const s3uri = S3.buildS3Uri(bucket, key);
    log.info(`Sync ${remoteUrl} to ${s3uri}`);

    const client = await this.buildFtpClient();

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
      ContentType: lookupMimeType(key)
    };
    await S3.promiseS3Upload(params);
    log.info('Uploading to s3 is complete(ftp)', s3uri);

    client.destroy();

    return s3uri;
  }
}

module.exports = FtpProviderClient;
