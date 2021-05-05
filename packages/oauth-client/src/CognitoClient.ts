import got, { HTTPError, Response } from 'got';

import { URL } from 'url';

import { OAuthClient } from './OAuthClient';
import { CognitoError } from './CognitoError';

type CognitoErrorResponse = Response<{
  error: string,
  error_description: string,
}>;

const validateUrl = (urlString: string) => {
  // eslint-disable-next-line no-new
  new URL(urlString);
};

// TODO test this. Do we get errors other than 401?
const isHttpUnauthorizedError = (error: unknown) =>
  error instanceof HTTPError && error.response.statusCode === 401;

const httpErrorToCognitoError = (httpError: HTTPError) => {
  const response = <CognitoErrorResponse>httpError.response;

  if (response.body && response.body.error) {
    return new CognitoError(
      response.body.error,
      response.body.error_description
    );
  }

  return new CognitoError(
    'UnexpectedResponse',
    `Unexpected response: ${httpError.response.body}`
  );
};

/**
 * A client for the Cognito API
 */
export class CognitoClient extends OAuthClient {
  readonly clientId: string;
  readonly clientPassword: string;
  readonly cognitoLoginUrl: string;
  readonly redirectUri: string;

  /**
   * @param {Object} params
   * @param {string} params.clientId - see example
   * @param {string} params.clientPassword - see example
   * @param {string} params.cognitoLoginUrl - see example
   * @param {string} params.redirectUri - see example
   *
   * @example
   *
   * const oAuth2Provider = new CognitoClient({
   *   clientId: 'my-client-id',
   *   clientPassword: 'my-client-password',
   *   cognitoLoginUrl: 'https://earthdata.login.nasa.gov',
   *   redirectUri: 'http://my-api.com'
   * });
   */

  constructor(
    params: {
      clientId: string,
      clientPassword: string,
      cognitoLoginUrl: string,
      redirectUri: string
    }
  ) {
    if (!params.clientId) throw new TypeError('clientId is required');
    if (!params.clientPassword) throw new TypeError('clientPassword is required');
    if (!params.cognitoLoginUrl) throw new TypeError('cognitoLoginUrl is required');
    if (!params.redirectUri) throw new TypeError('redirectUri is required');

    super({
      clientId: params.clientId,
      clientPassword: params.clientPassword,
      loginUrl: params.cognitoLoginUrl,
      redirectUri: params.redirectUri,
    });

    this.clientId = params.clientId;
    this.clientPassword = params.clientPassword;
    validateUrl(params.cognitoLoginUrl);
    this.cognitoLoginUrl = params.cognitoLoginUrl;
    validateUrl(params.redirectUri);
    this.redirectUri = params.redirectUri;
  }

  async getUserInfo(accessToken: string) {
    if (!accessToken) throw new TypeError('accessToken is required');

    try {
      const response = await super.getRequest({
        path: 'oauth/userInfo',
        accessToken,
      });

      return response.body;
    } catch (error) {
      if (error instanceof got.ParseError) {
        throw new CognitoError(
          'InvalidResponse',
          'Response from Cognito was not valid JSON'
        );
      }

      if (isHttpUnauthorizedError(error)) {
        throw httpErrorToCognitoError(error);
      }

      throw error;
    }
  }

  /**
   * Given an authorization code, request an access token and associated
   * information from the Cognito login service. This overrides the
   * base class for better, Cognito-specific errors.
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
      throw httpErrorToCognitoError(error);
    }
  }

  /**
   * Given a refresh token, request an access token and associated information
   * from the login service. This overrides the base class for better,
   * Cognito-specific errors.
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
      throw httpErrorToCognitoError(error);
    }
  }
}
