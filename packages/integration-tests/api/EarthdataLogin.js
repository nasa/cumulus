const base64 = require('base-64');
const got = require('got');

const { createEarthdataLoginClient } = require('@cumulus/api/lib/EarthdataLogin');

/**
 * Login to Earthdata
 *
 * @param {string} authorizeUrl
 *   The OAuth authorization endpoint for Earthdata login
 * @param {string} requestOrigin
 *   The URL to use as the "origin" for the request Earthdata login
 *
 * @return {Promise}
 *   Promise from the request to login with Earthdata
 */
async function handleEarthdataLogin({
  redirectUri,
  requestOrigin,
  state
}) {
  const earthdataLoginClient = createEarthdataLoginClient(redirectUri);
  const authorizeUrl = earthdataLoginClient.getAuthorizationUrl(state);

  const auth = base64.encode(`${process.env.EARTHDATA_USERNAME}:${process.env.EARTHDATA_PASSWORD}`);

  const requestOptions = {
    form: true,
    body: { credentials: auth },
    headers: {
      origin: requestOrigin // must equal an origin allowed for Earthdata
    },
    followRedirect: false
  };

  const redirectUrl = await got.post(authorizeUrl, requestOptions)
    .then((res) => res.headers.location);

  // Make request to redirect URL to exchange Earthdata authorization code
  // for access token.
  return got(redirectUrl, { followRedirect: false });
}

module.exports = {
  handleEarthdataLogin
};
