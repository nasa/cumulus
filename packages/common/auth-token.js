'use strict';

const got = require('got');
const base64 = require('base-64');
const parseurl = require('parseurl');
const FormData = require('form-data');
const launchpad = require('./launchpad');

class AuthTokenError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Gets EDL authorization URL
 * @param {string} url - oauth2 provider url to get authorization from
 * @param {Object<FormData>} form - login/password FormData object to submit
 * @param {string} baseUrl - API base url used to validate auth code redirect is
 *                           redirecting to the right api
 * @returns {Object<Error>} - Returns the redirect 302 error from EDL
 */
const getEdlAuthorization = async (url, form, baseUrl) => {
  const urlObj = parseurl({ url });
  let edlReturn;
  try {
    edlReturn = await got.post(`${urlObj.href}`, { body: form, headers: { origin: `${urlObj.protocol}//${urlObj.host}` } });
  } catch (error) {
    if (error.statusCode === 302 && error.headers.location.includes(baseUrl)) {
      return error.headers.location;
    }
    throw error;
  }
  throw new AuthTokenError(`Invalid endpoint configuration on Earthdata Login token request ${JSON.stringify(edlReturn)}`);
};

/**
 * Get a bearer token from EDL Oauth for use with the Cumulus API
 * @param {Object} config - config object
 * @param {string} config.baseUrl - Cumulus API baseUrl
 * @param {string} config.username - EDL Username to use for auth
 * @param {string} config.password - EDL password to use for auth
 * @returns {string} - Bearer token used to authenticate with the Cumulus API
 */
const getEdlToken = async (config) => {
  const tokenOutput = await got.get(`${config.baseUrl}token`, { followRedirect: false });
  const auth = base64.encode(`${config.username}:${config.password}`);
  const form = new FormData();
  form.append('credentials', auth);

  const location = await getEdlAuthorization(tokenOutput.headers.location, form, config.baseUrl);

  const edlOutput = await got.get(location);
  return JSON.parse(edlOutput.body).message.token;
};

/**
 * Get a bearer token from launchpad auth for use with the Cumulus API
 * @param {Object} config - config object
 * @param {string} config.launchpadPassphrase - Launchpad passphrase to use for auth
 * @param {string} config.launchpadApi - URL of launchpad api to use for authorization
 * @param {string} config.launchpadCertificate - key of certificate object stores in the
 *                                          internal crypto bucket
 */
const getLaunchpadToken = async (config) => {
  const launchpadToken = await launchpad.getLaunchpadToken({
    passphrase: config.launchpadPassphrase,
    api: config.launchpadApi,
    certificate: config.launchpadCertificate
  });
  return launchpadToken;
};

/**
 * Returns an auth token using the 'provider' and a passed in configuration object
 * @param {string} provider - auth provider to use  Either 'launchpad' or 'earthdata'
 *                            'google is not currently supported'
 * @param {*} config - config object for auth function (see getEdlToken, getLaunchpadToken, etc)
 */
const getAuthToken = async (provider, config) => {
  if (provider === 'launchpad') {
    return getLaunchpadToken(config);
  }

  if (provider === 'earthdata') {
    return getEdlToken(config);
  }

  if (provider === 'google') {
    throw new AuthTokenError('The "google" provider is not currently supported by common/auth-token');
  }
  throw new AuthTokenError(`Invalid provider ${JSON.stringify(provider)} specified`);
};
module.exports = {
  getAuthToken,
  getEdlToken,
  getLaunchpadToken
};
