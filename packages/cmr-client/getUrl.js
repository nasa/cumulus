'use strict';

const get = require('lodash.get');

/**
 * Returns the environment specific identifier for the input cmr environment.
 * @param {string} env - cmr environment ['OPS', 'SIT', 'UAT']
 * @returns {string} - value to use to build correct cmr url for environment.
 */
function hostId(env) {
  return get(
    { OPS: '', SIT: 'sit', UAT: 'uat' },
    env,
    'uat'
  );
}

/**
 * Determines the appropriate CMR host endpoint based on a given
 * value for CMR_ENVIRONMENT environment variable. Defaults
 * to the uat cmr
 *
 * @param {Object} environment - process env like object
 * @param {string} environment.CMR_ENVIRONMENT - [optional] CMR environment to
 *              use valid arguments are ['OPS', 'SIT', 'UAT'], anything that is
 *              not 'OPS' or 'SIT' will be interpreted as 'UAT'
 * @param {string} environment.CMR_HOST [optional] explicit host to return, if
 *              this has a value, it overrides any values for CMR_ENVIRONMENT
 * @returns {string} the cmr host address
 */
function getHost(environment = process.env) {
  const env = environment.CMR_ENVIRONMENT;
  if (environment.CMR_HOST) return environment.CMR_HOST;

  const host = ['cmr', hostId(env), 'earthdata.nasa.gov'].filter((d) => d).join('.');
  return host;
}

/**
 * returns the full url for various cmr services
 * based on the type passed, e.g. token, search, etc.
 *
 * @param {string} type - the type of the service, e.g. token, search
 * @param {string} cmrProvider - the CMR provider id
 * @returns {string} the cmr url
 */
function getUrl(type, cmrProvider) {
  let url;
  const host = getHost();
  const env = process.env.CMR_ENVIRONMENT;
  const provider = cmrProvider;

  switch (type) {
  case 'token':
    if (env === 'OPS') {
      url = 'https://api.echo.nasa.gov/echo-rest/tokens/';
    }
    else if (env === 'SIT') {
      url = 'https://testbed.echo.nasa.gov/echo-rest/tokens/';
    }
    else {
      url = 'https://api-test.echo.nasa.gov/echo-rest/tokens/';
    }
    break;
  case 'search':
    url = `https://${host}/search/`;
    break;
  case 'validate':
    url = `https://${host}/ingest/providers/${provider}/validate/`;
    break;
  case 'ingest':
    url = `https://${host}/ingest/providers/${provider}/`;
    break;
  default:
    url = null;
  }

  return url;
}

// TODO Too many exports
module.exports = {
  getUrl,
  getHost,
  hostId
};
