'use strict';

const got = require('got');
const log = require('./log');
const { getS3Object, s3ObjectExists } = require('./aws');

/**
 * A class for sending requests to Launchpad token service endpoints
 *
 * @example
 * const { LaunchpadToken } = require('@cumulus/common');
 *
 * const LaunchpadToken = new LaunchpadToken({
 *  api: 'launchpad-token-api-endpoint',
 *  passphrase: 'my-pki-passphrase',
 *  certificate: 'my-pki-certificate.pfx'
 * });
 *
 * @class LaunchpadToken
 */
class LaunchpadToken {
  /**
  * @param {Object} params
  * @param {string} params.api - the Launchpad token service api endpoint
  * @param {string} params.passphrase - the plaintext passphrase of the
  *   Launchpad PKI certificate
  * @param {string} params.certificate - the name of the Launchpad PKI pfx certificate
  */
  constructor(params) {
    this.api = params.api;
    this.passphrase = params.passphrase;
    this.certificate = params.certificate;
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

    const cryptKey = `${stackName}/crypto/${this.certificate}`;

    const keyExists = await s3ObjectExists(
      { Bucket: bucket, Key: cryptKey }
    );

    if (!keyExists) {
      return Promise.reject(new Error(`${this.certificate} does not exist in S3 crypto directory: ${cryptKey}`));
    }

    log.debug(`Reading Key: ${this.certificate} bucket:${bucket},stack:${stackName}`);
    const pfx = (await getS3Object(bucket, `${stackName}/crypto/${this.certificate}`)).Body;

    return { pfx, passphrase: this.passphrase };
  }

  /**
   * get token from launchpad
   *
   * @returns {Promise.<Object>} - the Launchpad gettoken response object
   */
  async requestToken() {
    log.debug('LaunchpadToken.requestToken');
    const { pfx, passphrase } = await this._retrieveCertificate();

    const response = await got.get(
      'gettoken',
      {
        baseUrl: this.api,
        json: true,
        passphrase,
        pfx
      }
    );

    return response.body;
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

    const response = await got.post(
      'validate',
      {
        baseUrl: this.api,
        json: true,
        body: { token },
        passphrase,
        pfx
      }
    );

    return response.body;
  }
}

module.exports = LaunchpadToken;
