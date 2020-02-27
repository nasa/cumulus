/* eslint-disable max-classes-per-file */
'use strict';

const got = require('got');
const base64 = require('base-64');
const parseurl = require('parseurl');
const { decryptBase64String, encrypt } = require('@cumulus/aws-client/KMS');
const FormData = require('form-data');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const launchpad = require('./launchpad');
const { decode } = require('jsonwebtoken');



class AuthTokenError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

class TokenCacheError extends Error {
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

  let location = await getEdlAuthorization(tokenOutput.headers.location, form, config.baseUrl);
  location = location.replace('.com', '.com:8000');
  const edlOutput = await got.get(location);
  return JSON.parse(edlOutput.body).message.token;
};

/**
 * Get a bearer token from launchpad atuh for use with the Cumulus API
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
    console.log('getting EDL token');
    return getEdlToken(config);
  }

  if (provider === 'google') {
    throw new AuthTokenError('The "google" provider is not currently supported by common/auth-token');
  }
  throw new AuthTokenError(`Invalid provider ${JSON.stringify(provider)} specified`);
};


const getAuthTokenRecord = async (tokenAlias, authTokenTable) => {
  const params = {
    TableName: authTokenTable,
    Key: {
      tokenAlias: tokenAlias
    }
  };

  const tokenResponse = await dynamodbDocClient().get(params).promise();
  if (!tokenResponse.Item) {
    throw new TokenCacheError(`No bearer token with alias '${tokenAlias}' found in ${authTokenTable}`);
  }
  return decryptBase64String(tokenResponse.Item.bearerToken);
};

const updateAuthTokenRecord = async (tokenAlias, token, authTokenTable, kmsId) => {
  const encryptedToken = await encrypt(kmsId, token);
  const params = {
    TableName: authTokenTable,
    Key: {
      tokenAlias: tokenAlias
    },
    UpdateExpression: 'set bearerToken = :t',
    ExpressionAttributeValues: {
      ':t': encryptedToken
    }
  };
  return dynamodbDocClient().update(params).promise();
};

const refreshAuthToken = async (config, token) => {
  const tokenResponse = await got.post(`${config.baseUrl}refresh`, {
    json: true,
    form: true,
    body: { token }
  });
  return tokenResponse.body.token;
};

/**
 * Attempts to retrieve an active auth token from <data store>
 * If no token exists, attempt a token refresh.  If the token refresh fails
 * request a new token from the auth provider.
 * @param {*} token
 * @param {*} provider
 * @param {*} config
 */
const getCachedAuthToken = async (tokenSecretName, authTokenTable, config, provider) => {
  // get token
  let token;
  try {
    token = await getAuthTokenRecord(tokenSecretName, authTokenTable);
    const tokenMinutesRemaining = (Date.now() / 1000) / 60;
    if (tokenMinutesRemaining <= 0) {
      throw new TokenCacheError('Token expired, obtraining new token');
    }
    if (tokenMinutesRemaining <= 15 && tokenMinutesRemaining > 0) { // TODO make configurable
      return refreshAuthToken(config, token);
    }
    return token;
  } catch (error) {
    console.log('here');
    console.log(`Error Will Robinson ${JSON.stringify(error)}`);
    console.log(error.message);
    if (error.name === 'TokenCacheError') {
      console.log('getting new token');

      const updateToken = await getAuthToken(provider, config);
      console.log(updateToken);
      return updateAuthTokenRecord(tokenSecretName, updateToken, authTokenTable, 'af21403c-1f04-4a6e-a3e2-3b605fb7912d'); // If all else fails, re-auth
    }
    throw Error;
  }
  return Promise.reject(new AuthTokenError('Failed to retreive token'));
};

module.exports = {
  getCachedAuthToken,
  updateAuthTokenRecord,
  getAuthTokenRecord,
  getAuthToken,
  getEdlToken,
  getLaunchpadToken
};
