'use strict';

const got = require('got');
const { URL } = require('url');

const { ClientAuthenticationError } = require('./errors');

class EarthdataLoginClient {
  constructor(params) {
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

  authorizationUrl(state) {
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

  async getAccessToken(authorizationCode) {
    if (!authorizationCode) throw new TypeError('authorizationCode is required');

    const url = new URL(this.earthdataLoginUrl);
    url.pathname = '/oauth/token';

    try {
      const response = await got.post(
        url.toString(),
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

      return {
        accessToken: response.body.access_token,
        username: response.body.endpoint.split('/').pop(),
        expirationTime: Date.now() + (response.body.expires_in * 1000)
      };
    }
    catch (err) {
      if (
        err.name === 'HTTPError'
        && err.statusCode === 400
        && err.response.body.error === 'invalid_grant'
      ) {
        throw new ClientAuthenticationError();
      }

      throw err;
    }
  }
}
module.exports = EarthdataLoginClient;
