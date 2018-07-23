const { google } = require('googleapis');
const got = require('got');
const plus = google.plus('v1');
const log = require('@cumulus/common/log');
const OAuth2 = google.auth.OAuth2;

const oauth2Client = new OAuth2(
  process.env.EARTHDATA_CLIENT_ID,
  process.env.EARTHDATA_CLIENT_PASSWORD,
  process.env.API_ENDPOINT
);

function redirectUriParam() {
  const url = process.env.API_ENDPOINT;
  return encodeURIComponent(url);
}

function googleOAuthLoginUrl(state) {
  // generate a url that asks permissions for Google+ and Google Calendar scopes
  const scopes = [
    'https://www.googleapis.com/auth/userinfo.email'
  ];

  const url = oauth2Client.generateAuthUrl({
    // 'online' (default) or 'offline' (gets refresh_token)
    access_type: 'offline',

    // If you only need one scope you can pass it as a string
    scope: scopes,
    state: state
  });

  return url;
}

function earthDataLoginUrl(state) {
  const endpoint = process.env.EARTHDATA_BASE_URL;
  const clientId = process.env.EARTHDATA_CLIENT_ID;

  let url = `${endpoint}/oauth/authorize?` +
              `client_id=${clientId}&` +
              `redirect_uri=${redirectUriParam()}&response_type=code`;
  if (state) {
    url = `${url}&state=${encodeURIComponent(state)}`;
  }

  return url;
}

function generateLoginUrl(state) {
  if (process.env.OAUTH_PROVIDER === 'google') {
    return googleOAuthLoginUrl(state);
  }
  return earthDataLoginUrl(state);
}

async function fetchGoogleToken(code) {
  const { tokens } = await oauth2Client.getToken(code);
  const accessToken = tokens.access_token;
  const tokenExpires = tokens.expiry_date;
  const expires = (+new Date()) + (tokenExpires * 1000);
  // The refresh_token is only returned on the first authorization
  const refresh = tokens.refresh_token || null;

  oauth2Client.setCredentials(tokens);

  const response = await plus.people.get({userId: 'me', auth: oauth2Client});
  const userData = response.data;
  // not sure if it's possible to have multiple emails but they are
  // returned as a list. If users have multiple emails we will have to
  // scan the users table to see if any match.
  const userName = userData.emails[0].value;
  const responseObject = {
    userName, accessToken, refresh, expires
  };
  return responseObject;
}

function fetchEarthdataToken(code) {
  const EARTHDATA_CLIENT_ID = process.env.EARTHDATA_CLIENT_ID;
  const EARTHDATA_CLIENT_PASSWORD = process.env.EARTHDATA_CLIENT_PASSWORD;
  const EARTHDATA_BASE_URL = process.env.EARTHDATA_BASE_URL || 'https://uat.urs.earthdata.nasa.gov';
  const EARTHDATA_CHECK_CODE_URL = `${EARTHDATA_BASE_URL}/oauth/token`;
  const params = `?grant_type=authorization_code&code=${code}&redirect_uri=${redirectUriParam()}`;

  // Verify token
  return got.post(EARTHDATA_CHECK_CODE_URL + params, {
    json: true,
    auth: `${EARTHDATA_CLIENT_ID}:${EARTHDATA_CLIENT_PASSWORD}`
  })
    .then((r) => {
      const tokenInfo = r.body;
      const accessToken = tokenInfo.access_token;

      // if no access token is given, then the code is wrong
      if (typeof accessToken === 'undefined') {
        return new Error('Failed to get Earthdata token');
      }

      const refresh = tokenInfo.refresh_token;
      const userName = tokenInfo.endpoint.split('/').pop();
      const expires = (+new Date()) + (tokenInfo.expires_in * 1000);

      return {
        userName, accessToken, refresh, expires
      };
    });
}

async function getToken(code) {
  if (process.env.OAUTH_PROVIDER === 'google') {
    return fetchGoogleToken(code);
  }
  return fetchEarthdataToken(code);
}

module.exports = {
  getToken,
  generateLoginUrl
};
