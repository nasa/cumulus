'use strict';

const { OAuth2 } = require('./OAuth2');

class GoogleOAuth2 extends OAuth2 {
  constructor(googleOAuth2Client, googlePlusPeopleClient) {
    super();

    if (!googleOAuth2Client) throw new TypeError('googleOAuth2Client is required');
    this.googleOAuth2Client = googleOAuth2Client;

    if (!googlePlusPeopleClient) throw new TypeError('googlePlusPeopleClient is required');
    this.googlePlusPeopleClient = googlePlusPeopleClient;
  }

  getAuthorizationUrl(state) {
    return this.googleOAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: 'https://www.googleapis.com/auth/userinfo.email',
      state: state
    });
  }

  async getAccessToken(authorizationCode) {
    if (!authorizationCode) throw new TypeError('authorizationCode is required');

    const { tokens } = await this.googleOAuth2Client.getToken(authorizationCode);

    this.googleOAuth2Client.setCredentials(tokens);

    const userDataResponse = await this.googlePlusPeopleClient.get({
      userId: 'me',
      auth: this.googleOAuth2Client
    });

    return {
      accessToken: tokens.access_token,
      expirationTime: tokens.expiry_date,
      refreshToken: tokens.refresh_token,
      username: userDataResponse.data.emails[0].value
    };
  }
}
module.exports = GoogleOAuth2;
