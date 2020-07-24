import { URL } from 'url';
import got from 'got';

import Logger from '@cumulus/logger';
import { getS3Object, s3ObjectExists } from '@cumulus/aws-client/S3';

import {
  LaunchpadTokenParams,
  GetTokenResponse,
  ValidateTokenResponse
} from './types';
import { getEnvVar } from './utils';

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
  private readonly api: string;
  private readonly passphrase: string;
  private readonly certificate: string;

  /**
  * @param {Object} params
  * @param {string} params.api - the Launchpad token service api endpoint
  * @param {string} params.passphrase - the passphrase of the Launchpad PKI certificate
  * @param {string} params.certificate - the name of the Launchpad PKI pfx certificate
  */
  constructor(params: LaunchpadTokenParams) {
    this.api = params.api;
    this.passphrase = params.passphrase;
    this.certificate = params.certificate;
  }

  /**
   * Retrieve Launchpad credentials
   *
   * @returns {Promise<S3.GetObjectOutput.Body | undefined>} - body of certificate found on S3
   * @private
   */
  private async retrieveCertificate() {
    const bucket = getEnvVar('system_bucket');
    const stackName = getEnvVar('stackName');

    // we are assuming that the specified certificate file is in the S3 crypto directory
    const cryptKey = `${stackName}/crypto/${this.certificate}`;

    const keyExists = await s3ObjectExists(
      { Bucket: bucket, Key: cryptKey }
    );

    if (!keyExists) {
      throw new Error(`${this.certificate} does not exist in S3 crypto directory: ${cryptKey}`);
    }

    log.debug(`Reading Key: ${this.certificate} bucket:${bucket},stack:${stackName}`);

    const pfxObject = await getS3Object(bucket, `${stackName}/crypto/${this.certificate}`);
    // MUST NOT add .toString() to this value, otherwise value is too large when sent as a
    // request header
    const pfx = pfxObject?.Body;

    return pfx;
  }

  /**
   * Get a token from Launchpad
   *
   * @returns {Promise<Object>} - the Launchpad gettoken response object
   */
  async requestToken(): Promise<GetTokenResponse> {
    log.debug('LaunchpadToken.requestToken');
    const pfx = await this.retrieveCertificate();
    const launchpadUrl = new URL(this.api);

    const options = {
      port: launchpadUrl.port || 443,
      prefixUrl: this.api,
      pfx,
      https: {
        passphrase: this.passphrase
      }
    };

    const response = await got.get('gettoken', options).json();
    return <GetTokenResponse>response;
  }

  /**
   * Validate a Launchpad token
   *
   * @param {string} token - the Launchpad token for validation
   * @returns {Promise<Object>} - the Launchpad validate token response object
   */
  async validateToken(token: string): Promise<ValidateTokenResponse> {
    log.debug('LaunchpadToken.validateToken');
    const pfx = await this.retrieveCertificate();
    const launchpadUrl = new URL(this.api);

    const data = JSON.stringify({ token });
    const options = {
      port: launchpadUrl.port || 443,
      prefixUrl: this.api,
      body: data,
      pfx,
      https: {
        passphrase: this.passphrase
      },
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length.toString()
      }
    };

    const response = await got.post('validate', options).json();
    return <ValidateTokenResponse>response;
  }
}

export = LaunchpadToken;
