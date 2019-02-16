const base64 = require('base-64');
const got = require('got');

const EarthdataLogin = require('@cumulus/api/lib/EarthdataLogin');

/**
 * Login to Earthdata and make request to redirect from Earthdata
 *
 * @param {Object} params
 * @param {string} params.redirectUri
 *   The redirect URL to use for the Earthdata login client
 * @param {string} params.requestOrigin
 *   The URL to use as the "origin" for the request Earthdata login
 * @param {string} params.state
 *   The "state" query parameter included in the redirect back from Earthdata login
 *
 * @returns {Promise}
 *   Promise from the request to the redirect from Earthdata
 */
async function getEarthdataLoginRedirectResponse({
  redirectUri,
  requestOrigin,
  state
}) {
  if (!process.env.EARTHDATA_USERNAME) {
    throw new Error('EARTHDATA_USERNAME environment variable is required');
  }
  else if (!process.env.EARTHDATA_PASSWORD) {
    throw new Error('EARTHDATA_PASSWORD environment variable is required');
  }

  // Create Earthdata client and get authorization URL.
  const earthdataLoginClient = EarthdataLogin.createFromEnv({
    redirectUri
  });
  const authorizeUrl = earthdataLoginClient.getAuthorizationUrl(state);

  // Prepare request options for login to Earthdata.
  const auth = base64.encode(`${process.env.EARTHDATA_USERNAME}:${process.env.EARTHDATA_PASSWORD}`);
  const requestOptions = {
    form: true,
    body: { credentials: auth },
    headers: {
      origin: requestOrigin // must equal an origin allowed for Earthdata
    },
    followRedirect: false
  };

  // Make request to login to Earthdata.
  let redirectUrl;
  try {
    const loginResponse = await got.post(authorizeUrl, requestOptions);
    redirectUrl = loginResponse.headers.location;
  }
  catch (err) {
    if (err.statusCode === 401) {
      throw new Error(
        'Unauthorized: Check that your EARTHDATA_USERNAME and EARTHDATA_PASSWORD values can be used for log into the Earthdata app specified by the EARTHDATA_CLIENT_ID'
      );
    }
    throw err;
  }

  if (!redirectUrl.includes(redirectUri)) {
    throw new Error(
      `Redirect failed. Check that ${redirectUri} has been added as a redirect URI to the Earthdata app specified by the EARTHDATA_CLIENT_ID`
    );
  }

  // Make request to redirect URL to exchange Earthdata authorization code
  // for access token.
  return got(redirectUrl, { followRedirect: false });
}

module.exports = {
  getEarthdataLoginRedirectResponse
};
