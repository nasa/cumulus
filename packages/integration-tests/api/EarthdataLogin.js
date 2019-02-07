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
  // Create Earthdata client and get authorization URL.
  const earthdataLoginClient = EarthdataLogin.createFromEnv({
    redirectUri
  });
  const authorizeUrl = earthdataLoginClient.getAuthorizationUrl(state);

  console.log(process.env.EARTHDATA_USERNAME);

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
  const redirectUrl = await got.post(authorizeUrl, requestOptions)
    .then((res) => {
      console.log(res.req._headers);
      return res.headers.location;
    });

  // Make request to redirect URL to exchange Earthdata authorization code
  // for access token.
  return got(redirectUrl, { followRedirect: false });
}

module.exports = {
  getEarthdataLoginRedirectResponse
};
