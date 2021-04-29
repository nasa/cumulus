import { URL } from 'url';

import { AuthClient } from './AuthClient';

const validateUrl = (urlString: string) => {
  // eslint-disable-next-line no-new
  new URL(urlString);
};

/**
 * A client for the Cognito API
 */
export class CognitoClient extends AuthClient {
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
}
