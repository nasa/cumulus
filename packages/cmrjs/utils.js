const got = require('got');
const _get = require('lodash.get');
const publicIp = require('public-ip');
const { deprecate } = require('@cumulus/common/util');
const { ValidationError } = require('@cumulus/cmr-client');

// getUrl is not part of the public cmr-client API
const getUrl = require('@cumulus/cmr-client/getUrl');
// validate is not part of the public cmr-client API
const { validate } = require('@cumulus/cmr-client/ingestConcept');

const xmlParseOptions = {
  ignoreAttrs: true,
  mergeAttrs: true,
  explicitArray: false
};

/**
 * Returns the environment specific identifier for the input cmr environment.
 * @deprecated
 * @param {string} env - cmr environment ['OPS', 'SIT', 'UAT']
 * @returns {string} - value to use to build correct cmr url for environment.
 */
function hostId(env) {
  console.log('Function hostId is deprecated as of version 1.11.2');
  return _get(
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
 * @deprecated
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
  console.log('Function getHost is deprecated as of version 1.11.2');
  const env = environment.CMR_ENVIRONMENT;
  if (environment.CMR_HOST) return environment.CMR_HOST;

  const host = ['cmr', hostId(env), 'earthdata.nasa.gov'].filter((d) => d).join('.');
  return host;
}

/**
 * Find the UMM version as a decimal string.
 * If a version cannot be found on the input object
 * version 1.4 is assumed and returned.
 *
 * @deprecated
 *
 * @param {Object} umm - UMM metadata object
 * @returns {string} UMM version for the given object
 */
function ummVersion(umm) {
  deprecate('@cumulus/cmrjs/utils#ummVersion', '1.11.1');
  return _get(umm, 'MetadataSpecification.Version', '1.4');
}

/**
 * Transform UMM version number to metadata format string.
 *
 * @param {string} versionNumber - UMM version string in decimal format (e.g. 1.4)
 * @returns {string} UMM-G metadata format string (e.g. umm_json_v1_4)
 */
function ummVersionToMetadataFormat(versionNumber, ummFormat = 'json') {
  return `umm_${ummFormat}_v${versionNumber.replace('.', '_')}`;
}

/**
 * Posts a given xml string to the validate endpoint of CMR
 * and promises true of valid.
 *
 * @deprecated
 *
 * @param {string} ummMetadata - the UMM object
 * @param {string} identifier - the document identifier
 * @param {string} provider - the CMR provider
 * @returns {Promise<boolean>} returns true if the document is valid
 */
async function validateUMMG(ummMetadata, identifier, provider) {
  deprecate('@cumulus/cmrjs/utils#validateUMMG', '1.11.1');
  const version = ummVersion(ummMetadata);
  let result;

  try {
    result = await got.post(`${getUrl('validate', provider, process.env.CMR_ENVIRONMENT)}granule/${identifier}`, {
      json: true,
      body: ummMetadata,
      headers: {
        Accept: 'application/json',
        'Content-type': `application/vnd.nasa.cmr.umm+json;version=${version}`
      }
    });

    if (result.statusCode === 200) {
      return true;
    }
  }
  catch (e) {
    result = e.response;
  }

  throw new ValidationError(
    `Validation was not successful. UMM metadata Object: ${JSON.stringify(ummMetadata)}`
  );
}

/**
 * Returns IP address.
 *
 * For Lambdas which are launched into a private subnet, no public IP is available
 * and the function falls back to an environment variable, if defined, and  a
 * static string if not defined. The value returned should be a valid IP address or
 * else the request for a CMR token will fail.
 *
 * @deprecated
 *
 * @returns {string} IP address
 */
async function getIp() {
  console.log('Function getIp is deprecated as of version 1.11.2');
  return publicIp.v4()
    .catch((err) => {
      if (err.message === 'Query timed out') {
        return process.env.USER_IP_ADDRESS || '10.0.0.0';
      }

      throw err;
    });
}

/**
 * Returns a valid a CMR token
 *
 * @deprecated
 *
 * @param {string} cmrProvider - the CMR provider id
 * @param {string} clientId - the CMR clientId
 * @param {string} username - CMR username
 * @param {string} password - CMR password
 * @returns {Promise.<string>} the token
 */
async function updateToken(cmrProvider, clientId, username, password) {
  console.log('Function updateToken is deprecated as of version 1.11.2');
  if (!cmrProvider) throw new Error('cmrProvider is required.');
  if (!clientId) throw new Error('clientId is required.');
  if (!username) throw new Error('username is required.');
  if (!password) throw new Error('password is required.');

  // Update the saved ECHO token
  // for info on how to add collections to CMR: https://cmr.earthdata.nasa.gov/ingest/site/ingest_api_docs.html#validate-collection
  let response;

  try {
    response = await got.post(getUrl('token', null, process.env.CMR_ENVIRONMENT), {
      json: true,
      body: {
        token: {
          username: username,
          password: password,
          client_id: clientId,
          user_ip_address: await getIp(),
          provider: cmrProvider
        }
      }
    });
  }
  catch (err) {
    if (err.response.body.errors) throw new Error(`CMR Error: ${err.response.body.errors[0]}`);
    throw err;
  }

  if (!response.body.token) throw new Error('Authentication with CMR failed');

  return response.body.token.id;
}

module.exports = {
  ValidationError,
  getHost,
  getIp,
  getUrl,
  hostId,
  ummVersion,
  ummVersionToMetadataFormat,
  updateToken,
  validate,
  validateUMMG,
  xmlParseOptions
};
