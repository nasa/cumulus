import got, { CancelableRequest, Headers, HTTPError, Response } from 'got';
import { URL } from 'url';

import { OAuthError } from './OAuthError';

const validateUrl = (urlString: string) => {
  // eslint-disable-next-line no-new
  new URL(urlString);
};

type AccessTokenResponse = Response<{
  access_token: string,
  refresh_token: string,
  endpoint: string,
  expires_in: number
}>;

type OAuthErrorResponse = Response<{
  error: string,
  error_description: string,
}>;

const encodeCredentials = (username: string, password: string) =>
  Buffer.from(`${username}:${password}`).toString('base64');

/**
 * A generic authorization client
 */
export class OAuthClient {
  readonly clientId: string;
  readonly clientPassword: string;
  readonly loginUrl: string;
  readonly redirectUri: string;

  /**
   * @param {Object} params
   * @param {string} params.clientId - see example
   * @param {string} params.clientPassword - see example
   * @param {string} params.loginUrl - see example
   * @param {string} params.redirectUri - see example
   *
   * @example
   *
   * const oAuth2Provider = new OAuthClient({
   *   clientId: 'my-client-id',
   *   clientPassword: 'my-client-password',
   *   loginUrl: 'https://earthdata.login.nasa.gov',
   *   redirectUri: 'http://my-api.com'
   * });
   */
  constructor(
    params: {
      clientId: string,
      clientPassword: string,
      loginUrl: string,
      redirectUri: string
    }
  ) {
    const {
      clientId,
      clientPassword,
      loginUrl,
      redirectUri,
    } = params;

    if (!clientId) throw new TypeError('clientId is required');
    this.clientId = clientId;

    if (!clientPassword) throw new TypeError('clientPassword is required');
    this.clientPassword = clientPassword;

    if (!loginUrl) throw new TypeError('loginUrl is required');
    validateUrl(loginUrl);
    this.loginUrl = loginUrl;

    if (!redirectUri) throw new TypeError('redirectUri is required');
    validateUrl(redirectUri);
    this.redirectUri = redirectUri;
  }

  /**
   * Get a URL of the Login authorization endpoint
   *
   * @param {string} [state] - an optional state to pass to login Client
   * @returns {string} the Login authorization URL
   */
  getAuthorizationUrl(state?: string): string {
    const url = new URL('/oauth/authorize', this.loginUrl);

    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('response_type', 'code');

    if (state) {
      url.searchParams.set('state', state);
    }

    return url.toString();
  }

  private requestAccessToken(authorizationCode: string) {
    return <CancelableRequest<AccessTokenResponse>>(this.postRequest({
      path: 'oauth/token',
      form: {
        grant_type: 'authorization_code',
        code: authorizationCode,
        redirect_uri: this.redirectUri,
      },
    }));
  }

  httpErrorToAuthError = (httpError: HTTPError) => {
    const response = <OAuthErrorResponse>httpError.response;

    if (response.body && response.body.error) {
      return new OAuthError(
        response.body.error,
        response.body.error_description
      );
    }

    return new OAuthError(
      'UnexpectedResponse',
      `Unexpected response: ${httpError.response.body}`
    );
  };

  /**
   * Given an authorization code, request an access token and associated
   * information from the login service.
   *
   * Returns an object with the following properties:
   *
   * - accessToken
   * - refreshToken
   * - username (optional, if "endpoint" is provided by client API response)
   * - expirationTime (in seconds)
   *
   * @param {string} authorizationCode - an OAuth2 authorization code
   * @returns {Promise<Object>} access token information
   */
  async getAccessToken(authorizationCode: string): Promise<Object> {
    if (!authorizationCode) throw new TypeError('authorizationCode is required');

    try {
      const response = await this.requestAccessToken(authorizationCode);

      return {
        accessToken: response.body.access_token,
        refreshToken: response.body.refresh_token,
        username: response.body.endpoint ? response.body.endpoint.split('/').pop() : undefined,
        // expires_in value is in seconds
        expirationTime: Math.floor(Date.now() / 1000) + response.body.expires_in,
      };
    } catch (error) {
      throw this.httpErrorToAuthError(error);
    }
  }

  /**
   * Make an HTTP POST request to the login service
   *
   * @param {Object} params
   * @param {string} params.path - the URL for the request
   * @param {Object} params.form - the body of the POST request
   * @param {Object} [params.headers] - Optional request headers
   * @returns {CancelableRequest<Response<unknown>>} The return of the POST call
   */
  postRequest(
    params: {
      path: string,
      form: { [key: string]: any },
      headers?: Headers,
    }
  ) {
    // https://github.com/sindresorhus/got/issues/1169
    const credentials = encodeCredentials(this.clientId, this.clientPassword);

    return got.post(
      params.path,
      {
        prefixUrl: this.loginUrl,
        headers: {
          ...params.headers,
          Authorization: `Basic ${credentials}`,
        },
        form: params.form,
        responseType: 'json',
      }
    );
  }

  /**
   * Make an HTTP GET request to the login service
   *
   * @param {Object} params
   * @param {string} params.path - the URL for the request
   * @param {string} params.token - Auth bearer token for request
   * @param {Object} [params.headers] - Optional request headers
   * @param {Object} [params.searchParams] - Optional search parameters
   * @returns {CancelableRequest<Response<unknown>>} The return of the GET call
   */
  getRequest(
    params: {
      path: string,
      token: string,
      headers?: Headers,
      searchParams?: { [key: string]: any },
    }
  ) {
    const { path, token, headers, searchParams } = params;
    return got.get(
      path,
      {
        prefixUrl: this.loginUrl,
        headers: {
          ...headers,
          Authorization: `Bearer ${token}`,
        },
        responseType: 'json',
        searchParams,
      }
    );
  }

  private requestRefreshAccessToken(refreshToken: string) {
    return <CancelableRequest<AccessTokenResponse>>(this.postRequest({
      path: 'oauth/token',
      form: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
    }));
  }

  /**
   * Given a refresh token, request an access token and associated information
   * from the login service.
   *
   * Returns an object with the following properties:
   *
   * - accessToken
   * - refreshToken
   * - username (optional, if "endpoint" is provided by client API response)
   * - expirationTime (in seconds)
   *
   * @param {string} refreshToken - an OAuth2 refresh token
   * @returns {Promise<Object>} access token information
   */
  async refreshAccessToken(refreshToken: string): Promise<Object> {
    if (!refreshToken) throw new TypeError('refreshToken is required');

    try {
      const response = await this.requestRefreshAccessToken(refreshToken);

      return {
        accessToken: response.body.access_token,
        refreshToken: response.body.refresh_token,
        username: response.body.endpoint ? response.body.endpoint.split('/').pop() : undefined,
        expirationTime: Math.floor(Date.now() / 1000) + response.body.expires_in,
      };
    } catch (error) {
      throw this.httpErrorToAuthError(error);
    }
  }
}
