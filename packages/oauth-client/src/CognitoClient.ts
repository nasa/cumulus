import { HTTPError, Response } from 'got';

import { URL } from 'url';

import { OAuthClient } from './OAuthClient';
import { CognitoError } from './CognitoError';

type CognitoErrorResponse = Response<{error: string}>;

const validateUrl = (urlString: string) => {
  // eslint-disable-next-line no-new
  new URL(urlString);
};

const isHttpForbiddenError = (error: unknown) =>
  error instanceof HTTPError && error.response.statusCode === 403;

const httpErrorToCognitoError = (httpError: HTTPError) => {
  const response = <CognitoErrorResponse>httpError.response;

  switch (response.body.error) {
    case 'invalid_token':
      return new CognitoError('InvalidToken', 'Invalid token');
    case 'token_expired':
      return new CognitoError('TokenExpired', 'The token has expired');
    default:
      return new CognitoError(
        'UnexpectedResponse',
        `Unexpected response: ${httpError.response.body}`
      );
  }
};

/**
 * A client for the Cognito API
 */
export class CognitoClient extends OAuthClient {
  readonly clientId: string;
  readonly clientPassword: string;
  readonly cognitoLoginUrl: string;
  readonly redirectUri: string;

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

  // GET /oauth/userInfo
  async getUserInfo(accessToken: string) {
    if (!accessToken) throw new TypeError('accessToken is required');

    try {
      const response = await super.getRequest({
        path: 'oauth/userInfo',
        accessToken,
      });

      return response.body;
    } catch (error) {
      if (isHttpForbiddenError(error)) {
        throw httpErrorToCognitoError(error);
      }

      throw error;
    }
  }

  // POST /authclient/updatePassword
  // POST /authclient/updateRedirectUri
  // DELETE /authclient/updateRedirectUri=
}
