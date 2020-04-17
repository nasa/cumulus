'use strict';

const https = require('https');
const path = require('path');
const { URL } = require('url');
const Logger = require('@cumulus/logger');
const { getS3Object, s3ObjectExists } = require('@cumulus/aws-client/S3');

const log = new Logger({ sender: '@cumulus/launchpad-auth/LaunchpadToken' });

/**
 * @class
 * @classdesc A class for sending requests to Launchpad token service endpoints
 *
 * @example
 * const LaunchpadToken = require('@cumulus/launchpad-auth/LaunchpadToken');
 *
 * const launchpadToken = new LaunchpadToken({
 *  api: 'launchpad-token-api-endpoint',
 *  passphrase: 'my-pki-passphrase',
 *  certificate: 'my-pki-certificate.pfx'
 * });
 *
 * @alias LaunchpadToken
 */
class LaunchpadToken {
  /**
  * @param {Object} params
  * @param {string} params.api - the Launchpad token service api endpoint
  * @param {string} params.passphrase - the passphrase of the Launchpad PKI certificate
  * @param {string} params.certificate - the name of the Launchpad PKI pfx certificate
  */
  constructor(params) {
    this.api = params.api;
    this.passphrase = params.passphrase;
    this.certificate = params.certificate;
  }

  /**
   * Retrieve Launchpad credentials
   *
   * @returns {Promise<Buffer>} - an object with the pfx
   * @private
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

    const cryptKey = `${stackName}/crypto/${this.certificate}`;

    const keyExists = await s3ObjectExists(
      { Bucket: bucket, Key: cryptKey }
    );

    if (!keyExists) {
      return Promise.reject(new Error(`${this.certificate} does not exist in S3 crypto directory: ${cryptKey}`));
    }

    log.debug(`Reading Key: ${this.certificate} bucket:${bucket},stack:${stackName}`);
    const pfx = (await getS3Object(bucket, `${stackName}/crypto/${this.certificate}`)).Body;

    return pfx;
  }

  /**
   * Get a token from Launchpad
   *
   * @returns {Promise.<Object>} - the Launchpad gettoken response object
   */
  async requestToken() {
    log.debug('LaunchpadToken.requestToken');
    const pfx = await this._retrieveCertificate();
    const launchpadUrl = new URL(this.api);

    const options = {
      hostname: launchpadUrl.hostname,
      port: launchpadUrl.port || 443,
      path: path.join(launchpadUrl.pathname, 'gettoken'),
      method: 'GET',
      pfx,
      passphrase: this.passphrase
    };

    const responseBody = await this._submitRequest(options);
    return JSON.parse(responseBody);
  }

  /**
   * Validate a Launchpad token
   *
   * @param {string} token - the Launchpad token for validation
   * @returns {Promise.<Object>} - the Launchpad validate token response object
   */
  async validateToken(token) {
    log.debug('LaunchpadToken.validateToken');
    const pfx = await this._retrieveCertificate();
    const launchpadUrl = new URL(this.api);

    const data = JSON.stringify({ token });
    const options = {
      hostname: launchpadUrl.hostname,
      port: launchpadUrl.port || 443,
      path: path.join(launchpadUrl.pathname, 'validate'),
      method: 'POST',
      pfx,
      passphrase: this.passphrase,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const responseBody = await this._submitRequest(options, data);
    return JSON.parse(responseBody);
  }

  /**
   * Submit HTTPS request
   *
   * @param {Object} options - the Launchpad token for validation
   * @param {string} data - the request body
   * @returns {Promise.<string>} - the response body
   * @private
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

module.exports = LaunchpadToken;
