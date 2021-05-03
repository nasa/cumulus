import got, { HTTPError, Response } from 'got';

import { URL } from 'url';

import { OAuthClient } from './OAuthClient';
import { CognitoError } from './CognitoError';

type CognitoErrorResponse = Response<{error: string}>;

const validateUrl = (urlString: string) => {
  // eslint-disable-next-line no-new
  new URL(urlString);
};

// TODO test this. Do we get errors other than 401?
const isHttpUnauthorizedError = (error: unknown) =>
  error instanceof HTTPError && error.response.statusCode === 401;

const httpErrorToCognitoError = (httpError: HTTPError) => {
  const response = <CognitoErrorResponse>httpError.response;

  if (response.body.error === 'invalid_token') {
    return new CognitoError('InvalidToken', 'Invalid token');
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
}
