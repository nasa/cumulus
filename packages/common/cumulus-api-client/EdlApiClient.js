'use strict';

const got = require('got');
const base64 = require('base-64');
const parseurl = require('parseurl');
const FormData = require('form-data');
const CumulusApiClient = require('./CumulusApiClient');


class EdlApiClient extends CumulusApiClient {
  /**
   * Sets required keys, calls superclass constructor
  * @param {Object} config - config object
  * @param {string} config.baseUrl - Cumulus API baseUrl
  * @param {string} config.username - EDL username to use for auth
  * @param {string} config.password - EDL password to use for auth
  * @param {string} config.kmsId - ID of the AWS KMS key used for encryption/decryption
  * @param {string} config.tokenSecretName - 'Cached bearer token name alias to utilize
  * @param {string} config.authTokenTable - Dynamodb table to use for token caching
  */
  constructor(config) {
    const requiredKeys = ['kmsId', 'baseUrl', 'username', 'password', 'tokenSecretName', 'authTokenTable'];
    super(config, requiredKeys);
  }

  /**
  * Gets EDL authorization URL
  * @param {string} url - oauth2 provider url to get authorization from
  * @param {Object<FormData>} form - login/password FormData object to submit
  * @param {string} baseUrl - API base url used to validate auth code redirect is
  *                           redirecting to the right api
  * @returns {Object<Error>} - Returns the redirect 302 error from EDL
  */
  async getEdlAuthorization(url, form, baseUrl) {
    const urlObj = parseurl({ url });
    let edlReturn;
    try {
      edlReturn = await got.post(`${urlObj.href}`, { body: form, headers: { origin: `${urlObj.protocol}//${urlObj.host}` } });
    } catch (error) {
      if (error.statusCode === 302 && error.headers.location.includes(baseUrl)) {
        return error.headers.location;
      }
      throw error;
    }
    throw new this.Error(`Invalid endpoint configuration on Earthdata Login token request ${JSON.stringify(edlReturn)}`);
  }

  /**x
  * Get a bearer token from EDL Oauth for use with the Cumulus API
  *
  * @returns {string} - Bearer token used to authenticate with the Cumulus API
  */
  async createNewAuthToken() {
    const tokenOutput = await got.get(`${this.config.baseUrl}/token`, { followRedirect: false });
    console.log(`tokenOutput: ${tokenOutput}`);
    const auth = base64.encode(`${this.config.username}:${this.config.password}`);

    const form = new FormData();
    form.append('credentials', auth);

    const location = await this.getEdlAuthorization(tokenOutput.headers.location,
      form, this.config.baseUrl);
    // location = location.replace('.com', '.com:8000');
    const edlOutput = await got.get(location);
    return JSON.parse(edlOutput.body).message.token;
  }
}

module.exports = EdlApiClient;
