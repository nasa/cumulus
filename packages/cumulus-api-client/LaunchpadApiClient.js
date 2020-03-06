'use strict';

const LaunchpadToken = require('@cumulus/common/LaunchpadToken.js');
const CumulusApiClient = require('./CumulusApiClient');

class LaunchpadApiClient extends CumulusApiClient {
  /**
   * Sets required keys, calls superclass constructor
   * @memberof LaunchpadApiClient
   *
   * @param {Object} config - config object
   * @param {string} config.launchpadPassphrase  - Launchpad passphrase to use for auth
   * @param {string} config.launchpadApi         - URL of launchpad api to use for authorization
   * @param {string} config.launchpadCertificate - key of certificate object stores in the
   *                                               internal crypto bucket
   * @param {string} config.userGroup            - User group for use with launchpad oauth
   * @param {string} config.tokenSecretName      - 'Cached bearer token name alias to utilize
   * @param {string} config.kmsId                - ID of the AWS KMS key used for
   *                                               cryption/decryption
   * @param {string} config.authTokenTable       - Dynamodb table to use for token caching
   * @param {string} config.baseUrl              - Cumulus API baseUrl
   * @param {boolean} config.disableTokenInitialize - boolean flag to skip token initialization
   */
  constructor(config) {
    const requiredKeys = ['kmsId', 'userGroup', 'launchpadPassphrase', 'launchpadApi',
      'launchpadCertificate', 'tokenSecretName', 'authTokenTable', 'baseUrl'];
    super(config, requiredKeys);
    this.launchpadToken = new LaunchpadToken({
      passphrase: this.config.launchpadPassphrase,
      api: this.config.launchpadApi,
      certificate: this.config.launchpadCertificate
    });
  }

  /**
   * Overwrites base class validation method - launchpad verifiction
   * is based on a server call the API does by default, so
   * checking here results in potential duplicate calls.
   *
   * Rely on authRetry in the get method instead.
   * @memberof LaunchpadApiClient
   *
   * @returns {boolean} true
   */
  async _validateTokenExpiry() {
    return true;
  }

  async refreshAuthToken(_token) {
    throw new this.Error('Token refresh is not supported for Launchpad auth');
  }

  /**
   * Helper function to check via the Launchpad api how much time the token has left.
   * @memberof LaunchpadApiClient
   *
   * @param {string} token - Launchpad bearer token
   * @returns {number} - the number of seconds left before the token expires
   */
  async getTokenTimeLeft(token) {
    const validationResponse = await this.launchpadToken.validateToken(token);
    return Math.max(validationResponse.session_idleremaining,
      validationResponse.session_maxremaining);
  }

  /**
  * Get a bearer token from launchpad auth for use with the Cumulus API
  * @memberof LaunchpadApiClient
  *
  * @returns {string} - Bearer token used to authenticate with the Cumulus API
  */
  async createNewAuthToken() {
    this.logger.info('Creating new token');
    const tokenResponse = await this.launchpadToken.requestToken();
    return tokenResponse.sm_token;
  }
}

module.exports = LaunchpadApiClient;
