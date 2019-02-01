const base64 = require('base-64');
const got = require('got');

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
function handleEarthdataLogin(authorizeUrl, requestOrigin) {
  const auth = base64.encode(`${process.env.EARTHDATA_USERNAME}:${process.env.EARTHDATA_PASSWORD}`);

  const requestOptions = {
    form: true,
    body: { credentials: auth },
    headers: {
      origin: requestOrigin // must equal an origin allowed for Earthdata
    },
    followRedirect: false
  };

  return got.post(authorizeUrl, requestOptions);
}

module.exports = {
  handleEarthdataLogin
};
