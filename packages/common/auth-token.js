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

const getEdlAuthorization = async (urlObj, form, baseUrl) => {
  let edlReturn;
  try {
    edlReturn = await got.post(`${urlObj.href}`, { body: form, headers: { origin: `${urlObj.protocol}//${urlObj.host}` } });
  } catch (error) {
    if (error.statusCode === 302 && error.headers.location.includes(baseUrl)) {
      return error;
    }
    throw error;
  }
  throw new AuthTokenError(`Invalid endpoint configuration on Earthdata Login token request ${JSON.stringify(edlReturn)}`);
};

const getEdlToken = async (config) => {
  const tokenOutput = await got.get(`${config.baseUrl}token`, { followRedirect: false });
  const urlObj = parseurl({ url: tokenOutput.headers.location });
  const auth = base64.encode(`${config.username}:${config.password}`);

  const form = new FormData();
  form.append('credentials', auth);

  const edlAuthReturn = await getEdlAuthorization(urlObj, form, config.baseUrl);
  const location = edlAuthReturn.headers.location;

  const edlOutput = await got.get(location);
  return JSON.parse(edlOutput.body).message.token;
};

const getLaunchpadToken = async (config) => {
  const launchpadToken = await launchpad.getLaunchpadToken({
    passphrase: config.launchpadPassphrase,
    api: config.launchpadApi,
    certificate: config.launchpadCertificate
  });
  return launchpadToken;
};

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
