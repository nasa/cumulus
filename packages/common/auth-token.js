'use strict';

const got = require('got');
const base64 = require('base-64');
const parseurl = require('parseurl');
const FormData = require('form-data');
const launchpad = require('./launchpad');


const getEdlToken = async (urlObj, form) => {
  let edlReturn;
  try {
    edlReturn = await got.post(`${urlObj.href}`, { body: form, headers: { origin: `${urlObj.protocol}//${urlObj.host}` } })
  } catch (error) {
    if (error.statusCode === 302 && error.headers.location) {
      return error;
    }
    throw error;
  }
  throw new Error(`Invalid endpoint configuration on Earthdata Login token request ${JSON.stringify(edlReturn)}`);
};

const getAuthToken = async (provider, config) => {
  // Needs internal bucket and stack env vars configured
  if (provider === 'launchpad') {
    const launchpadToken = await launchpad.getLaunchpadToken({
      passphrase: config.passphrase,
      api: 'https://api.launchpad.nasa.gov/icam/api/sm/v1/gettoken',
      certificate: 'launchpad.pfx' // TODO add cert env variable
    });
    return launchpadToken;
  }

  if (provider === 'earthdata') {
    const tokenOutput = await got.get(`${config.baseUrl}/dev/token`, { followRedirect: false });
    const urlObj = parseurl({ url: tokenOutput.headers.location });
    const auth = base64.encode(`${config.username}:${config.password}`);

    const form = new FormData();
    form.append('credentials', auth);

    const edlReturn = await getEdlToken(urlObj, form);
    const location = edlReturn.headers.location;

    // Shim due to local port 8000 testing, TODO remove for testing, or... use testing env var, or .... :thinking face:
    // TODO: we should remove it as this isn't intended to run locally and we can rewire for tests.
    // location = location.replace('.com', '.com:8000');
    const edlOutput = await got.get(location);
    return JSON.parse(edlOutput.body).message.token;
  }

  throw new Error(`Invalid provider ${provider} specified`);// We need to call token endpoint similar to api example token
};


module.exports = getAuthToken;
