import got, { HTTPError, Response } from 'got';

import { OAuthClient } from './OAuthClient';
import { CognitoError } from './CognitoError';

type CognitoErrorResponse = Response<{
  error: string,
  error_description: string,
}>;

/**
 * A client for the Cognito API
 */
export class CognitoClient extends OAuthClient {
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
   * const oAuth2Provider = new CognitoClient({
   *   clientId: 'my-client-id',
   *   clientPassword: 'my-client-password',
   *   loginUrl: 'https://auth.csdap.sit.earthdatacloud.nasa.gov/',
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
    super(params);

    const {
      clientId,
      clientPassword,
      loginUrl,
      redirectUri,
    } = params;

    this.clientId = clientId;
    this.clientPassword = clientPassword;
    this.loginUrl = loginUrl;
    this.redirectUri = redirectUri;
  }

  httpErrorToAuthError = (httpError: HTTPError) => {
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

      throw this.httpErrorToAuthError(error);
    }
  }
}
