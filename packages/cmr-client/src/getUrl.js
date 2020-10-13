'use strict';

const hostId = require('./hostId');

/**
 * Determines the appropriate CMR host endpoint based on a given
 * value for CMR_ENVIRONMENT environment variable. Defaults
 * to the uat cmr
 *
 * @param {string} cmrEnvironment - [optional] CMR environment to
 *              use valid arguments are ['OPS', 'SIT', 'UAT'], anything that is
 *              not 'OPS' or 'SIT' will be interpreted as 'UAT'
 * @param {string} cmrHost [optional] explicit host to return, if
 *              this has a value, it overrides any values for cmrEnvironment
 * @returns {string} the cmr host address
 */
function getHost(cmrEnvironment, cmrHost) {
  if (cmrHost) return cmrHost;
  const host = ['cmr', hostId(cmrEnvironment), 'earthdata.nasa.gov'].filter((d) => d).join('.');
  return host;
}

/**
 * returns the full url for various cmr services
 * based on the type passed, e.g. token, search, etc.
 *
 * @param {string} type - the type of the service, e.g. token, search
 * @param {string} cmrProvider - the CMR provider id
 * @param {string} cmrEnvironment - CMR environment to
 *              use valid arguments are ['OPS', 'SIT', 'UAT']
 * @param {string} cmrHost - CMR host
 * @returns {string} the cmr url
 */
function getUrl(type, cmrProvider, cmrEnvironment, cmrHost) {
  let url;
  const cmrEnv = cmrEnvironment || process.env.CMR_ENVIRONMENT || null;
  const host = getHost(cmrEnv, cmrHost);
  const provider = cmrProvider;

  switch (type) {
  case 'token':
    if (cmrEnv === 'OPS') {
      url = 'https://cmr.earthdata.nasa.gov/legacy-services/rest/tokens';
    } else {
      url = 'https://cmr.uat.earthdata.nasa.gov/legacy-services/rest/tokens';
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

module.exports = getUrl;
