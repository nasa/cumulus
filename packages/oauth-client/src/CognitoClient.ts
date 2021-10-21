import got, { HTTPError, Response } from 'got';

import { OAuthClient } from './OAuthClient';
import { CognitoError } from './CognitoError';

type CognitoErrorResponse = Response<{
  error: string,
  error_description: string,
}>;

/**
 * A client for the Cognito API. Extents OAuthClient.
 */
export class CognitoClient extends OAuthClient {
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

  /**
   * Query the API for the user object associated with an access token.
   *
   * @param {Object} params
   * @param {string} params.token - The access token for Authorization header
   * @param {string} [params.xRequestId] - a string to help identify the request
   * @returns {Promise<Object>} The user object (see example)
   *
   * @example
   *
   * {
   *  "username": "janedoe",
   *  "given_name": "Jane",
   *  "family_name": "Doe",
   *  "study_area": "Atmospheric Composition",
   *  "organization": "NASA",
   *  "email": "janedoe@example.com"
   * }
   */
  async getUserInfo(params: {
    token: string,
    xRequestId?: string,
  }) {
    const { token, xRequestId } = params || {};
    if (!token) throw new TypeError('token is required');
    const headers = xRequestId ? { 'X-Request-Id': xRequestId } : undefined;

    try {
      const response = await super.getRequest({
        path: 'oauth/userInfo',
        token,
        headers,
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
