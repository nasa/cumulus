import { URL } from 'url';

const validateUrl = (urlString: string) => {
  // eslint-disable-next-line no-new
  new URL(urlString);
};

/**
 * A generic authorization client
 */
export class AuthClient {
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
   * const oAuth2Provider = new AuthClient({
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
   * @param {string} [state] - an optional state to pass to Login Client
   * @returns {string} the Login authorization URL
   */
  getAuthorizationUrl(state?: string) {
    const url = new URL('/oauth/authorize', this.loginUrl);

    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('response_type', 'code');

    if (state) {
      url.searchParams.set('state', state);
    }

    return url.toString();
  }
}
