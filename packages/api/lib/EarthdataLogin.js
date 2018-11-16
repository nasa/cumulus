'use strict';

const got = require('got');
const { URL } = require('url');

const log = require('@cumulus/common/log');

const {
  OAuth2AuthenticationError,
  OAuth2AuthenticationFailure,
  OAuth2
} = require('./OAuth2');

const isBadRequestError = (err) => err.name === 'HTTPError' && err.statusCode === 400;

/**
 * This is an interface to the Earthdata Login service.
 */
class EarthdataLogin extends OAuth2 {
  /**
   * @param {Object} params - params
   * @param {string} params.clientId - see example
   * @param {string} params.clientPassword - see example
   * @param {string} params.earthdataLoginUrl - see example
   * @param {string} params.redirectUri - see example
   *
   * @example
   *
   * const oAuth2Provider = new EarthdataLogin({
   *   clientId: 'my-client-id',
   *   clientPassword: 'my-client-password',
   *   earthdataLoginUrl: 'https://earthdata.login.nasa.gov',
   *   redirectUri: 'http://my-api.com'
   * });
   */
  constructor(params) {
    super();

    const {
      clientId,
      clientPassword,
      earthdataLoginUrl,
      redirectUri
    } = params;

    if (!clientId) throw new TypeError('clientId is required');
    this.clientId = clientId;

    if (!clientPassword) throw new TypeError('clientPassword is required');
    this.clientPassword = clientPassword;

    if (!earthdataLoginUrl) throw new TypeError('earthdataLoginUrl is required');
    this.earthdataLoginUrl = new URL(earthdataLoginUrl);

    if (!redirectUri) throw new TypeError('redirectUri is required');
    this.redirectUri = new URL(redirectUri);
  }

  /**
   * Get a URL of the Earthdata Login authorization endpoint
   *
   * @param {string} [state] - an optional state to pass to Earthdata Login
   * @returns {string} the Earthdata Login authorization URL
   */
  getAuthorizationUrl(state) {
    const url = new URL(this.earthdataLoginUrl);

    url.pathname = '/oauth/authorize';
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri.toString());
    url.searchParams.set('response_type', 'code');

    if (state) {
      url.searchParams.set('state', state);
    }

    return url.toString();
  }

  /**
   * Get the URL of the Earthdata Login token endpoint
   *
   * @returns {string} the URL of the Earthdata Login token endpoint
   */
  tokenEndpoint() {
    const url = new URL(this.earthdataLoginUrl);
    url.pathname = '/oauth/token';

    return url.toString();
  }

  requestAccessToken(authorizationCode) {
    return got.post(
      this.tokenEndpoint(),
      {
        json: true,
        form: true,
        body: {
          grant_type: 'authorization_code',
          code: authorizationCode,
          redirect_uri: this.redirectUri.toString()
        },
        auth: `${this.clientId}:${this.clientPassword}`
      }
    );
  }

  getTokenExpirationMs() {
    return 10 * 1000;
    // return 60 * 60 * 24 * 1000;
  }

  /**
   * Given an authorization code, request an access token and associated
   * information from the Earthdata Login service.
   *
   * Returns an object with the following properties:
   *
   * - accessToken
   * - refreshToken
   * - username
   * - expirationTime (in milliseconds)
   *
   * @param {string} authorizationCode - an OAuth2 authorization code
   * @returns {Promise<Object>} access token information
   */
  async getAccessToken(authorizationCode) {
    if (!authorizationCode) throw new TypeError('authorizationCode is required');

    try {
      const response = await this.requestAccessToken(authorizationCode);

      log.debug(`expires in: ${response.expires_in}`);

      return {
        accessToken: response.body.access_token,
        refreshToken: response.body.refresh_token,
        username: response.body.endpoint.split('/').pop(),
        expirationTime: Date.now() + this.getTokenExpirationMs(),
      };
    }
    catch (err) {
      if (isBadRequestError(err)) {
        throw new OAuth2AuthenticationFailure();
      }

      throw new OAuth2AuthenticationError(err.message);
    }
  }
}
module.exports = EarthdataLogin;
