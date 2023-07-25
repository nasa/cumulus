const base64 = require('base-64');
const got = require('got');
const { URL } = require('url');

const { AccessToken } = require('@cumulus/api');
const { EarthdataLoginClient } = require('@cumulus/oauth-client');

/**
 * Login to Earthdata and get access token.
 *
 * @param {Object} params
 * @param {string} params.redirectUri
 *   The redirect URL to use for the Earthdata login client
 * @param {string} params.requestOrigin
 *   The URL to use as the "origin" for the request Earthdata login
 * @param {Object} params.userParams
 *   optional object to overide the getAccessToken response with predetermined values.
 * @param {boolean} params.storeAccessToken
 *   Whether to store the access token received from Earthdata login
 *
 * @returns {Object}
 *   Access token object returned by Earthdata client
 */
async function getEarthdataAccessToken({
  redirectUri,
  requestOrigin,
  userParams = {},
  storeAccessToken = true,
}) {
  if (!process.env.EARTHDATA_USERNAME) {
    throw new Error('EARTHDATA_USERNAME environment variable is required');
  } else if (!process.env.EARTHDATA_PASSWORD) {
    throw new Error('EARTHDATA_PASSWORD environment variable is required');
  }

  // Create Earthdata client and get authorization URL.
  const earthdataLoginClient = new EarthdataLoginClient({
    clientId: process.env.EARTHDATA_CLIENT_ID,
    clientPassword: process.env.EARTHDATA_CLIENT_PASSWORD,
    loginUrl: process.env.EARTHDATA_BASE_URL || 'https://uat.urs.earthdata.nasa.gov/',
    redirectUri,
  });

  const authorizeUrl = earthdataLoginClient.getAuthorizationUrl();

  // Prepare request options for login to Earthdata.
  const auth = base64.encode(`${process.env.EARTHDATA_USERNAME}:${process.env.EARTHDATA_PASSWORD}`);
  const requestOptions = {
    form: { credentials: auth },
    headers: {
      origin: requestOrigin, // must equal an origin allowed for Earthdata
    },
    followRedirect: false,
  };

  // Make request to login to Earthdata.
  let redirectUrl;
  try {
    const loginResponse = await got.post(authorizeUrl, requestOptions);
    redirectUrl = loginResponse.headers.location;
  } catch (error) {
    if (error.statusCode === 401) {
      throw new Error(
        'Unauthorized: Check that your EARTHDATA_USERNAME and EARTHDATA_PASSWORD values can be used for log into the Earthdata app specified by the EARTHDATA_CLIENT_ID'
      );
    }
    throw error;
  }

  if (!redirectUrl.includes(redirectUri)) {
    throw new Error(
      `Redirect failed. Check that ${redirectUri} has been added as a redirect URI to the Earthdata app specified by the EARTHDATA_CLIENT_ID`
    );
  }

  const authorizationCode = new URL(redirectUrl).searchParams.get('code');
  if (!authorizationCode) {
    throw new Error(
      `Authorization code could not be found in redirect: ${redirectUrl}`
    );
  }

  let accessTokenResponse = await earthdataLoginClient.getAccessToken(authorizationCode);

  const userInfo = await earthdataLoginClient.getUserInfo({
    token: accessTokenResponse.accessToken,
    username: accessTokenResponse.username,
  });

  accessTokenResponse = { ...accessTokenResponse, tokenInfo: userInfo, ...userParams };

  if (storeAccessToken) {
    const accessTokenModel = new AccessToken();
    await accessTokenModel.create(accessTokenResponse);
  }

  return accessTokenResponse;
}

module.exports = {
  getEarthdataAccessToken,
};
