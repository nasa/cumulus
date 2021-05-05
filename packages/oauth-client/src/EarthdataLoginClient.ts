import got, { HTTPError, Response } from 'got';

import { OAuthClient } from './OAuthClient';
import { EarthdataLoginError } from './EarthdataLoginError';

type VerifyTokenResponse = Response<{uid: string}>;

type EarthdataLoginErrorResponse = Response<{error: string}>;

const isHttpForbiddenError = (error: unknown) =>
  error instanceof HTTPError && error.response.statusCode === 403;

const isHttpBadRequestError = (error: unknown) =>
  error instanceof HTTPError && error.response.statusCode === 400;

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
export class EarthdataLoginClient extends OAuthClient {
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
   * const oAuth2Provider = new EarthdataLoginClient({
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
    if (!params.clientId) throw new TypeError('clientId is required');
    if (!params.clientPassword) throw new TypeError('clientPassword is required');
    if (!params.earthdataLoginUrl) throw new TypeError('earthdataLoginUrl is required');
    if (!params.redirectUri) throw new TypeError('redirectUri is required');

    super({
      clientId: params.clientId,
      clientPassword: params.clientPassword,
      loginUrl: params.earthdataLoginUrl,
      redirectUri: params.redirectUri,
    });

    this.clientId = params.clientId;
    this.clientPassword = params.clientPassword;
    validateUrl(params.earthdataLoginUrl);
    this.earthdataLoginUrl = params.earthdataLoginUrl;
    validateUrl(params.redirectUri);
    this.redirectUri = params.redirectUri;
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
      const response = <VerifyTokenResponse>(await super.postRequest({
        loginPath: 'oauth/tokens/user',
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

  /**
   * Given an authorization code, request an access token and associated
   * information from the EarthdataLogin service. This overrides the
   * base class for better, EarthdataLogin-specific errors.
   *
   * See OAuthClient.getAccessToken(authorizationCode).
   *
   * @param {string} authorizationCode - an OAuth2 authorization code
   * @returns {Promise<Object>} access token information
   */
  async getAccessToken(authorizationCode: string): Promise<Object> {
    try {
      return await super.getAccessToken(authorizationCode);
    } catch (error) {
      if (isHttpBadRequestError(error)) {
        throw new EarthdataLoginError('BadRequest', error.message);
      }
      throw new EarthdataLoginError('Unknown', error.message);
    }
  }

  /**
   * Given a refresh token, request an access token and associated information
   * from the login service. This overrides the base class for better,
   * EarthdataLogin-specific errors.
   *
   * See OAuthClient.refreshAccessToken(authorizationCode).
   *
   * @param {string} refreshToken - an OAuth2 refresh token
   * @returns {Promise<Object>} access token information
   */
  async refreshAccessToken(refreshToken: string): Promise<Object> {
    try {
      return await super.refreshAccessToken(refreshToken);
    } catch (error) {
      if (isHttpBadRequestError(error)) {
        throw new EarthdataLoginError('BadRequest', error.message);
      }
      throw new EarthdataLoginError('Unknown', error.message);
    }
  }
}
