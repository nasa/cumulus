'use strict';

const got = require('got');
const moment = require('moment');
const { URL } = require('url');

const OAuth2 = require('./OAuth2');
const OAuth2AuthenticationError = require('./OAuth2AuthenticationError');
const OAuth2AuthenticationFailure = require('./OAuth2AuthenticationFailure');
const { EarthdataLoginError } = require('./errors');

const parseResponseBody = (body) => {
  try {
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new EarthdataLoginError(
        'InvalidResponse',
        'Response from Earthdata Login was not valid JSON'
      );
    }

    throw error;
  }
};

const isHttpError = (error) => error.name === 'HTTPError';

const isHttpBadRequestError = (error) =>
  isHttpError(error) && error.statusCode === 400;

const isHttpForbiddenError = (error) =>
  isHttpError(error) && error.statusCode === 403;

const httpErrorToEarthdataLoginError = (httpError) => {
  const parsedResponseBody = parseResponseBody(httpError.response.body);

  switch (parsedResponseBody.error) {
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

/**
 * This is an interface to the Earthdata Login service.
 */
class EarthdataLogin extends OAuth2 {
  /**
   * Create Earthdata login client using environment variables.
   *
   * @param {Object} params
   * @param {string} params.redirectUri
   *   The redirect URL to use for the Earthdata login client
   *
   * @returns {EarthdataLogin}
   *   An Earthdata login client
   */
  static createFromEnv({ redirectUri }) {
    return new EarthdataLogin({
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

  urlOfEndpoint(path) {
    const url = new URL(path, this.earthdataLoginUrl);

    return url.toString();
  }

  /**
   * Get the URL of the Earthdata Login token endpoint
   *
   * @returns {string} the URL of the Earthdata Login token endpoint
   */
  tokenEndpoint() {
    return this.urlOfEndpoint('/oauth/token');
  }

  requestAccessToken(authorizationCode) {
    return this.sendRequest({
      earthdataLoginPath: '/oauth/token',
      body: {
        grant_type: 'authorization_code',
        code: authorizationCode,
        redirect_uri: this.redirectUri.toString()
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
      const parsedResponseBody = JSON.parse(response.body);

      return {
        accessToken: parsedResponseBody.access_token,
        refreshToken: parsedResponseBody.refresh_token,
        username: parsedResponseBody.endpoint.split('/').pop(),
        // expires_in value is in seconds
        expirationTime: moment().unix() + parsedResponseBody.expires_in
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
      earthdataLoginPath: '/oauth/token',
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
      const parsedResponseBody = parseResponseBody(response.body);

      return {
        accessToken: parsedResponseBody.access_token,
        refreshToken: parsedResponseBody.refresh_token,
        username: parsedResponseBody.endpoint.split('/').pop(),
        expirationTime: moment().unix() + parsedResponseBody.expires_in
      };
    } catch (err) {
      if (isHttpBadRequestError(err)) {
        throw new OAuth2AuthenticationFailure();
      }

      throw new OAuth2AuthenticationError(err.message);
    }
  }

  async getTokenUsername({ onBehalfOf, token }) {
    try {
      const response = await this.sendRequest({
        earthdataLoginPath: '/oauth/tokens/user',
        body: {
          client_id: this.clientId,
          on_behalf_of: onBehalfOf,
          token
        }
      });

      const { uid } = parseResponseBody(response.body);

      return uid;
    } catch (error) {
      if (isHttpForbiddenError(error)) {
        throw httpErrorToEarthdataLoginError(error);
      }

      throw error;
    }
  }

  sendRequest({ earthdataLoginPath, body }) {
    return got.post(
      this.urlOfEndpoint(earthdataLoginPath),
      {
        headers: { accept: 'application/json' },
        auth: `${this.clientId}:${this.clientPassword}`,
        form: true,
        body
      }
    );
  }
}

module.exports = EarthdataLogin;
