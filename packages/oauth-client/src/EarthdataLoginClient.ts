import got, { HTTPError, Response } from 'got';

import { OAuthClient } from './OAuthClient';
import { EarthdataLoginError } from './EarthdataLoginError';

type VerifyTokenResponse = Response<{ uid: string }>;

type EarthdataLoginErrorResponse = Response<{ error: string }>;

const isHttpBadRequestError = (error: unknown) =>
  error instanceof HTTPError && error.response.statusCode === 400;

/**
 * A client for the Earthdata Login API. Extents OAuthClient.
 */
export class EarthdataLoginClient extends OAuthClient {
  /**
   * @param {Object} params
   * @param {string} params.clientId - see example
   * @param {string} params.clientPassword - see example
   * @param {string} params.loginUrl - see example
   * @param {string} params.redirectUri - see example
   *
   * @example
   *
   * const oAuth2Provider = new EarthdataLoginClient({
   *   clientId: 'my-client-id',
   *   clientPassword: 'my-client-password',
   *   loginUrl: 'https://earthdata.login.nasa.gov',
   *   redirectUri: 'http://my-api.com'
   * });
   */

  httpErrorToAuthError = (httpError: HTTPError) => {
    if (isHttpBadRequestError(httpError)) {
      throw new EarthdataLoginError('BadRequest', httpError.message);
    }

    const response = <EarthdataLoginErrorResponse>httpError.response;

    if (!response) {
      throw new EarthdataLoginError(
        'UnexpectedResponse',
        `Unexpected response: ${httpError}`
      );
    }

    switch (response.body.error) {
      case 'invalid_token':
        return new EarthdataLoginError('InvalidToken', 'Invalid token');
      case 'token_expired':
        return new EarthdataLoginError('TokenExpired', 'The token has expired');
      default:
        return new EarthdataLoginError(
          'UnexpectedResponse',
          `Unexpected response: ${JSON.stringify(httpError.response.body)}`
        );
    }
  };

  /**
   * Query the API for the user object associated with a user.
   *
   * @param {Object} params
   * @param {string} params.token - The access token for Authorization header
   * @param {string} params.username - The uid of the registered user
   * @param {string} [params.xRequestId] - a string to help identify the request
   * @returns {Promise<Object>} The user object (see example)
   *
   * @example
   *
   * {
   *  "uid": "janedoe",
   *  "first_name": "Jane",
   *  "last_name": "Doe",
   *  "registered_date": "15 Sep 2015 12:42:17PM",
   *  "email_address": "janedoe@example.com",
   *  "country": "United States",
   *  "affiliation": "Government",
   *  "authorized_date": "21 Apr 2016 01:13:28AM",
   *  "allow_auth_app_emails": true,
   *  "agreed_to_meris_eula": false,
   *  "agreed_to_sentinel_eula": false,
   *  "app_content": {
   *     "param1": "value1",
   *     "app_groups": {
   *         "test": {
   *            "param2": "value2"
   *          }
   *      }
   *  },
   *  "user_groups": [],
   *  "user_authorized_apps": 3
   * }
   */
  async getUserInfo(params: {
    token: string,
    username: string,
    xRequestId?: string,
  }) {
    const { token, xRequestId, username } = params || {};
    if (!token || !username) throw new TypeError('token and username are required');

    const headers = xRequestId ? { 'X-Request-Id': xRequestId } : undefined;
    try {
      const response = await super.getRequest({
        path: `api/users/${username}`,
        token,
        headers,
        searchParams: {
          client_id: this.clientId,
        },
      });

      return response.body;
    } catch (error) {
      if (error instanceof got.ParseError) {
        throw new EarthdataLoginError(
          'InvalidResponse',
          'Response from Earthdata Login was not valid JSON'
        );
      }

      throw this.httpErrorToAuthError(error);
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
      const response = <VerifyTokenResponse>(await super.postRequest({
        path: 'oauth/tokens/user',
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

      throw this.httpErrorToAuthError(error);
    }
  }
}
