import got, { CancelableRequest, HTTPError, Response } from 'got';
import { URL } from 'url';

import { EarthdataLoginError } from './EarthdataLoginError';

type AccessTokenResponse = Response<{
  access_token: string,
  refresh_token: string,
  endpoint: string,
  expires_in: number
}>;

type VerifyTokenResponse = Response<{uid: string}>;

type EarthdataLoginErrorResponse = Response<{error: string}>;

const encodeCredentials = (username: string, password: string) =>
  Buffer.from(`${username}:${password}`).toString('base64');

const isHttpBadRequestError = (error: unknown) =>
  error instanceof HTTPError && error.response.statusCode === 400;

const isHttpForbiddenError = (error: unknown) =>
  error instanceof HTTPError && error.response.statusCode === 403;

const httpErrorToEarthdataLoginError = (httpError: HTTPError) => {
  const response = <EarthdataLoginErrorResponse>httpError.response;

  switch (response.body.error) {
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

const validateUrl = (urlString: string) => {
  // eslint-disable-next-line no-new
  new URL(urlString);
};

/**
 * A client for the Earthdata Login API
 */
export class EarthdataLoginClient {
  readonly clientId: string;
  readonly clientPassword: string;
  readonly earthdataLoginUrl: string;
  readonly redirectUri: string;

  /**
   * @param {Object} params
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
  constructor(
    params: {
      clientId: string,
      clientPassword: string,
      earthdataLoginUrl: string,
      redirectUri: string
    }
  ) {
    const {
      clientId,
      clientPassword,
      earthdataLoginUrl,
      redirectUri,
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
  getAuthorizationUrl(state?: string) {
    const url = new URL('/oauth/authorize', this.earthdataLoginUrl);

    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('response_type', 'code');

    if (state) {
      url.searchParams.set('state', state);
    }

    return url.toString();
  }

  private requestAccessToken(authorizationCode: string) {
    return <CancelableRequest<AccessTokenResponse>>(this.sendRequest({
      earthdataLoginPath: 'oauth/token',
      form: {
        grant_type: 'authorization_code',
        code: authorizationCode,
        redirect_uri: this.redirectUri,
      },
    }));
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
  async getAccessToken(authorizationCode: string) {
    if (!authorizationCode) throw new TypeError('authorizationCode is required');

    try {
      const response = await this.requestAccessToken(authorizationCode);

      return {
        accessToken: response.body.access_token,
        refreshToken: response.body.refresh_token,
        username: response.body.endpoint.split('/').pop(),
        // expires_in value is in seconds
        expirationTime: Math.floor(Date.now() / 1000) + response.body.expires_in,
      };
    } catch (error) {
      if (isHttpBadRequestError(error)) {
        throw new EarthdataLoginError('BadRequest', error.message);
      }

      throw new EarthdataLoginError('Unknown', error.message);
    }
  }

  private requestRefreshAccessToken(refreshToken: string) {
    return <CancelableRequest<AccessTokenResponse>>(this.sendRequest({
      earthdataLoginPath: 'oauth/token',
      form: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
    }));
  }

  /**
   * Given a refresh token, request an access token and associated information
   * from the Earthdata Login service.
   *
   * Returns an object with the following properties:
   *
   * - accessToken
   * - refreshToken
   * - username
   * - expirationTime (in seconds)
   *
   * @param {string} refreshToken - an OAuth2 refresh token
   * @returns {Promise<Object>} access token information
   */
  async refreshAccessToken(refreshToken: string) {
    if (!refreshToken) throw new TypeError('refreshToken is required');

    try {
      const response = await this.requestRefreshAccessToken(refreshToken);

      return {
        accessToken: response.body.access_token,
        refreshToken: response.body.refresh_token,
        username: response.body.endpoint.split('/').pop(),
        expirationTime: Math.floor(Date.now() / 1000) + response.body.expires_in,
      };
    } catch (error) {
      if (isHttpBadRequestError(error)) {
        throw new EarthdataLoginError('BadRequest', error.message);
      }

      throw new EarthdataLoginError('Unknown', error.message);
    }
  }

  /**
   * Query the Earthdata Login API for the UID associated with a token
   *
   * @param {Object} params
   * @param {string} params.onBehalfOf - the Earthdata Login client id of the
   *   app requesting the username
   * @param {string} params.token - the Earthdata Login token
   * @param {string} [params.xRequestId] - a string to help identify the request
   *   in the Earthdata Login logs
   * @returns {Promise<string>} the UID associated with the token
   */
  async getTokenUsername(params: {
    onBehalfOf: string,
    token: string,
    xRequestId?: string
  }) {
    const { onBehalfOf, token, xRequestId } = params;

    const headers = xRequestId ? { 'X-Request-Id': xRequestId } : undefined;

    try {
      const response = <VerifyTokenResponse>(await this.sendRequest({
        earthdataLoginPath: 'oauth/tokens/user',
        headers,
        form: {
          client_id: this.clientId,
          on_behalf_of: onBehalfOf,
          token,
        },
      }));

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

  private sendRequest(
    params: {
      earthdataLoginPath: string,
      form: {[key: string]: any},
      headers?: Record<string, string|string[]|undefined>
    }
  ) {
    // https://github.com/sindresorhus/got/issues/1169
    const credentials = encodeCredentials(this.clientId, this.clientPassword);

    return got.post(
      params.earthdataLoginPath,
      {
        prefixUrl: this.earthdataLoginUrl,
        headers: {
          ...params.headers,
          Authorization: `Basic ${credentials}`,
        },
        form: params.form,
        responseType: 'json',
      }
    );
  }
}
