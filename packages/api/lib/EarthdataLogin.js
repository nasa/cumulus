'use strict';

const got = require('got');
const { URL } = require('url');

const {
  OAuth2AuthenticationError,
  OAuth2AuthenticationFailure,
  OAuth2
} = require('./OAuth2');

const isBadRequestError = (err) => err.name === 'HTTPError' && err.statusCode === 400;

class EarthdataLoginClient extends OAuth2 {
  constructor(params) {
    super();

    const {
      clientId,
      clientPassword,
      earthdataLoginUrl,
      redirectUri
    } = params;

    if (!clientId) throw new TypeError('clientId is required');
    this.clientId = clientId;

    if (!clientPassword) throw new TypeError('clientPassword is required');
    this.clientPassword = clientPassword;

    if (!earthdataLoginUrl) throw new TypeError('earthdataLoginUrl is required');
    this.earthdataLoginUrl = new URL(earthdataLoginUrl);

    if (!redirectUri) throw new TypeError('redirectUri is required');
    this.redirectUri = new URL(redirectUri);
  }

  getAuthorizationUrl(state) {
    const url = new URL(this.earthdataLoginUrl);
    url.pathname = '/oauth/authorize';
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri.toString());
    url.searchParams.set('response_type', 'code');

    if (state) {
      url.searchParams.set('state', state);
    }

    return url.toString();
  }

  tokenEndpoint() {
    const url = new URL(this.earthdataLoginUrl);
    url.pathname = '/oauth/token';

    return url.toString();
  }

  requestAccessToken(authorizationCode) {
    return got.post(
      this.tokenEndpoint(),
      {
        json: true,
        form: true,
        body: {
          grant_type: 'authorization_code',
          code: authorizationCode,
          redirect_uri: this.redirectUri.toString()
        },
        auth: `${this.clientId}:${this.clientPassword}`
      }
    );
  }

  async getAccessToken(authorizationCode) {
    if (!authorizationCode) throw new TypeError('authorizationCode is required');

    try {
      const response = await this.requestAccessToken(authorizationCode);

      return {
        accessToken: response.body.access_token,
        refreshToken: response.body.refresh_token,
        username: response.body.endpoint.split('/').pop(),
        expirationTime: Date.now() + (response.body.expires_in * 1000)
      };
    }
    catch (err) {
      if (isBadRequestError(err)) {
        throw new OAuth2AuthenticationFailure();
      }

      throw new OAuth2AuthenticationError(err.message);
    }
  }
}
module.exports = EarthdataLoginClient;
