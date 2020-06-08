'use strict';

const got = require('got');
const { URL } = require('url');

const { EarthdataLoginError } = require('./EarthdataLoginError');
const { OAuth2AuthenticationError } = require('./OAuth2AuthenticationError');
const { OAuth2AuthenticationFailure } = require('./OAuth2AuthenticationFailure');

const isHttpError = (error) => error.name === 'HTTPError';

const isHttpBadRequestError = (error) =>
  isHttpError(error) && error.response.statusCode === 400;

const isHttpForbiddenError = (error) =>
  isHttpError(error) && error.response.statusCode === 403;

const httpErrorToEarthdataLoginError = (httpError) => {
  switch (httpError.response.body.error) {
  case 'invalid_token':
    return new EarthdataLoginError('InvalidToken', 'Invalid token');
  case 'token_expired':
    return new EarthdataLoginError('TokenExpired', 'The token has expired');
  default:
    return new EarthdataLoginError(
      'UnexpectedResponse',
      `Unexpected response: ${httpError.response.body}`
    );
  }
};

const validateUrl = (urlString) => {
  // eslint-disable-next-line no-new
  new URL(urlString);
};

/**
 * This is an interface to the Earthdata Login service.
 */
class EarthdataLoginClient {
  /**
   * Create Earthdata login client using environment variables.
   *
   * @param {Object} params
   * @param {string} params.redirectUri
   *   The redirect URL to use for the Earthdata login client
   *
   * @returns {EarthdataLoginClient}
   *   An Earthdata login client
   */
  static createFromEnv({ redirectUri }) {
    return new EarthdataLoginClient({
      clientId: process.env.EARTHDATA_CLIENT_ID,
      clientPassword: process.env.EARTHDATA_CLIENT_PASSWORD,
      earthdataLoginUrl: process.env.EARTHDATA_BASE_URL || 'https://uat.urs.earthdata.nasa.gov/',
      redirectUri
    });
  }

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
    validateUrl(earthdataLoginUrl);
    this.earthdataLoginUrl = earthdataLoginUrl;

    if (!redirectUri) throw new TypeError('redirectUri is required');
    validateUrl(redirectUri);
    this.redirectUri = redirectUri;
  }

  /**
   * Get a URL of the Earthdata Login authorization endpoint
   *
   * @param {string} [state] - an optional state to pass to Earthdata Login
   * @returns {string} the Earthdata Login authorization URL
   */
  getAuthorizationUrl(state) {
    const url = new URL('/oauth/authorize', this.earthdataLoginUrl);

    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
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
    return (new URL('/oauth/token', this.earthdataLoginUrl)).toString();
  }

  requestAccessToken(authorizationCode) {
    return this.sendRequest({
      earthdataLoginPath: 'oauth/token',
      body: {
        grant_type: 'authorization_code',
        code: authorizationCode,
        redirect_uri: this.redirectUri
      }
    });
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
   * - expirationTime (in seconds)
   *
   * @param {string} authorizationCode - an OAuth2 authorization code
   * @returns {Promise<Object>} access token information
   */
  async getAccessToken(authorizationCode) {
    if (!authorizationCode) throw new TypeError('authorizationCode is required');

    try {
      const response = await this.requestAccessToken(authorizationCode);

      return {
        accessToken: response.body.access_token,
        refreshToken: response.body.refresh_token,
        username: response.body.endpoint.split('/').pop(),
        // expires_in value is in seconds
        expirationTime: Math.floor(Date.now() / 1000) + response.body.expires_in
      };
    } catch (err) {
      if (isHttpBadRequestError(err)) {
        throw new OAuth2AuthenticationFailure();
      }

      throw new OAuth2AuthenticationError(err.message);
    }
  }

  requestRefreshAccessToken(refreshToken) {
    return this.sendRequest({
      earthdataLoginPath: 'oauth/token',
      body: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }
    });
  }

  async refreshAccessToken(refreshToken) {
    if (!refreshToken) throw new TypeError('refreshToken is required');

    try {
      const response = await this.requestRefreshAccessToken(refreshToken);

      return {
        accessToken: response.body.access_token,
        refreshToken: response.body.refresh_token,
        username: response.body.endpoint.split('/').pop(),
        expirationTime: Math.floor(Date.now() / 1000) + response.body.expires_in
      };
    } catch (err) {
      if (isHttpBadRequestError(err)) {
        throw new OAuth2AuthenticationFailure();
      }

      throw new OAuth2AuthenticationError(err.message);
    }
  }

  async getTokenUsername({ onBehalfOf, token, xRequestId }) {
    const headers = xRequestId ? { 'X-Request-Id': xRequestId } : undefined;

    try {
      const response = await this.sendRequest({
        earthdataLoginPath: 'oauth/tokens/user',
        headers,
        body: {
          client_id: this.clientId,
          on_behalf_of: onBehalfOf,
          token
        }
      });

      return response.body.uid;
    } catch (error) {
      if (error instanceof got.ParseError) {
        throw new EarthdataLoginError(
          'InvalidResponse',
          'Response from Earthdata Login was not valid JSON'
        );
      }

      if (isHttpForbiddenError(error)) {
        throw httpErrorToEarthdataLoginError(error);
      }

      throw error;
    }
  }

  sendRequest({ earthdataLoginPath, headers, body }) {
    return got.post(
      earthdataLoginPath,
      {
        prefixUrl: this.earthdataLoginUrl,
        username: this.clientId,
        password: this.clientPassword,
        headers,
        form: body,
        responseType: 'json'
      }
    );
  }
}

module.exports = {
  EarthdataLoginClient
};
