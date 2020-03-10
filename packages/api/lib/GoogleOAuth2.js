'use strict';

const OAuth2 = require('./OAuth2');

class GoogleOAuth2 extends OAuth2 {
  /**
   * @param {Object} googleOAuth2Client - see example
   * @param {Object} googlePlusPeopleClient - see example
   *
   * @example
   *
   * const googleOAuth2Client = new google.auth.OAuth2(
   *   'my-client-id',
   *   'my-client-password',
   *   'http://my-api.com'
   * );
   *
   * const googlePlusPeopleClient = google.plus('v1').people;
   *
   * const oAuth2Provider = new GoogleOAuth2(googleOAuth2Client, googlePlusPeopleClient);
   */
  constructor(googleOAuth2Client, googlePlusPeopleClient) {
    super();

    if (!googleOAuth2Client) throw new TypeError('googleOAuth2Client is required');
    this.googleOAuth2Client = googleOAuth2Client;

    if (!googlePlusPeopleClient) throw new TypeError('googlePlusPeopleClient is required');
    this.googlePlusPeopleClient = googlePlusPeopleClient;
  }

  /**
   * Get a URL of the Google OAuth2 authorization endpoint
   *
   * @param {string} [state] - an optional state to pass to Google
   * @returns {string} the Google OAuth2 authorization URL
   */
  getAuthorizationUrl(state) {
    return this.googleOAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'],
      state: state
    });
  }

  /**
   * Given an authorization code, request an access token and associated
   * information from the Google OAuth2 service.
   *
   * Returns an object with the following properties:
   *
   * - accessToken
   * - refreshToken
   * - username
   * - expirationTime (in milliseconds)
   *
   * @param {string} authorizationCode - an OAuth2 authorization code
   * @returns {Promise<Object>} access token information
   */
  async getAccessToken(authorizationCode) {
    if (!authorizationCode) throw new TypeError('authorizationCode is required');

    const { tokens } = await this.googleOAuth2Client.getToken(authorizationCode);

    this.googleOAuth2Client.setCredentials(tokens);

    const userDataResponse = await this.googlePlusPeopleClient.people.get({
      resourceName: 'people/me',
      access_token: tokens.access_token,
      personFields: 'emailAddresses'
    });
    return {
      accessToken: tokens.access_token,
      expirationTime: tokens.expiry_date,
      refreshToken: tokens.refresh_token,
      username: userDataResponse.data.emailAddresses[0].value
    };
  }

  async refreshAccessToken() {
    throw new Error('Not implemented');
  }
}
module.exports = GoogleOAuth2;
