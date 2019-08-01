'use strict';

const https = require('https');
const path = require('path');
const { URL } = require('url');
const get = require('lodash.get');
const { DefaultProvider } = require('./key-pair-provider');
const log = require('./log');
const { getS3Object, s3ObjectExists } = require('./aws');

/**
 * A class for sending requests to Launchpad token service endpoints
 *
 * @class LaunchpadToken
 */
class LaunchpadToken {
  constructor(config) {
    // indicate passcode provided is encrypted
    this.encrypted = get(config, 'encrypted', true);
    this.api = config.api;
    this.passphrase = config.passphrase;
    this.certificate = config.certificate;
  }

  /**
   * retrieve launchpad credentials
   *
   * @returns {Promise.<Object.<Buffer, string>>} - an object with the pfx, passphrase
   */
  async _retrieveCertificate() {
    if (!(process.env.stackName || process.env.system_bucket)) {
      throw Promise.reject(
        new Error('must set environment variables process.env.stackName and process.env.system_bucket')
      );
    }
    const bucket = process.env.system_bucket;
    const stackName = process.env.stackName;
    // we are assuming that the specified certificate file is in the S3 crypto directory
    const keyExists = await s3ObjectExists(
      { Bucket: bucket, Key: `${stackName}/crypto/${this.certificate}` }
    );

    if (!keyExists) {
      return Promise.reject(new Error(`${this.certificate} does not exist in S3 crypto directory`));
    }

    log.debug(`Reading Key: ${this.certificate} bucket:${bucket},stack:${stackName}`);
    const pfx = (await getS3Object(bucket, `${stackName}/crypto/${this.certificate}`)).Body;

    const passphrase = this.encrypted
      ? await DefaultProvider.decrypt(this.passphrase) : this.passphrase;
    return { pfx, passphrase };
  }

  /**
   * get token from launchpad
   *
   * @returns {Promise.<Object>} - the Launchpad gettoken response object
   */
  async requestToken() {
    log.debug('LaunchpadToken.requestToken');
    const { pfx, passphrase } = await this._retrieveCertificate();
    const launchpadUrl = new URL(this.api);

    const options = {
      hostname: launchpadUrl.hostname,
      port: launchpadUrl.port || 443,
      path: path.join(launchpadUrl.pathname, 'gettoken'),
      method: 'GET',
      pfx,
      passphrase
    };

    const responseBody = await this._submitRequest(options);
    return JSON.parse(responseBody);
  }

  /**
   * validate Launchpad token
   *
   * @param {string} token - the Launchpad token for validation
   * @returns {Promise.<Object>} - the Launchpad validate token response object
   */
  async validateToken(token) {
    log.debug('LaunchpadToken.validateToken');
    const { pfx, passphrase } = await this._retrieveCertificate();
    const launchpadUrl = new URL(this.api);

    const data = JSON.stringify({ token });
    const options = {
      hostname: launchpadUrl.hostname,
      port: launchpadUrl.port || 443,
      path: path.join(launchpadUrl.pathname, 'validate'),
      method: 'POST',
      pfx,
      passphrase,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const responseBody = await this._submitRequest(options, data);
    return JSON.parse(responseBody);
  }

  /**
   * submit https request
   *
   * @param {Object} options - the Launchpad token for validation
   * @param {string} data - the request body
   * @returns {Promise.<string>} - the response body
   */
  _submitRequest(options, data) {
    return new Promise((resolve, reject) => {
      let responseBody = '';

      const req = https.request(options, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`launchpad request failed with statusCode ${res.statusCode} ${res.statusMessage}`));
        }

        res.on('data', (d) => {
          responseBody += d;
        });

        res.on('end', () => resolve(responseBody));
      });

      req.on('error', (e) => reject(e));

      if (data) req.write(data);
      req.end();
    });
  }
}

module.exports.LaunchpadToken = LaunchpadToken;
