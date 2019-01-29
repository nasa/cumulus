const base64 = require('base-64');
const got = require('got');

async function handleEarthdataLoginAndRedirect(authorizeUrl, requestOrigin) {
  const auth = base64.encode(`${process.env.EARTHDATA_USERNAME}:${process.env.EARTHDATA_PASSWORD}`);

  const requestOptions = {
    form: true,
    body: { credentials: auth },
    headers: {
      origin: requestOrigin
    },
    followRedirect: false
  };

  // Intercept the re-direct back to the Cumulus API
  const redirectUrl = await got.post(authorizeUrl, requestOptions)
    .then((res) => res.headers.location);

  // Make the redirect request to the Cumulus API. The URL for the redirect
  // includes an authorization code which is usually exchanged for an access
  // token by the redirect endpoint.
  const response = await got(redirectUrl, { followRedirect: false });
  return response;
}

module.exports = {
  handleEarthdataLoginAndRedirect
};
