const got = require('got');
const _get = require('lodash.get');
const publicIp = require('public-ip');
const xml2js = require('xml2js');


/**
 * Overrides the Error class
 *
 * @param {string} message - the error message
 */
function E(message) {
  Error.captureStackTrace(this, this.constructor);
  this.message = message;
}

/**
 * Creates a new error type with the given name and parent class. Sets up
 * boilerplate necessary to successfully subclass Error and preserve stack trace
 *
 * @param {string} name - The name of the error type
 * @param {Error} ParentType - The error that serves as the parent
 * @returns {Error} The new type
 */
const createErrorType = (name, ParentType = Error) => {
  E.prototype = new ParentType();
  E.prototype.name = name;
  E.prototype.constructor = E;
  return E;
};

const ValidationError = createErrorType('ValidationError');

/**
 * Returns the environment specific identifier for the input cmr environment.
 * @param {string} env - cmr environment ['OPS', 'SIT', 'UAT']
 * @returns {string} - value to use to build correct cmr url for environment.
 */
function hostId(env) {
  const id = {
    OPS: '',
    SIT: 'sit',
    UAT: 'uat'
  };
  return _get(id, env, 'uat');
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

const xmlParseOptions = {
  ignoreAttrs: true,
  mergeAttrs: true,
  explicitArray: false
};

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

/**
 * Posts a given xml string to the validate endpoint of the CMR
 * and returns the results
 *
 * @param {string} type - service type
 * @param {string} xml - the xml document
 * @param {string} identifier - the document identifier
 * @param {string} provider - the CMR provider
 * @returns {Promise.<boolean>} returns true if the document is valid
 */
async function validate(type, xml, identifier, provider) {
  let result;
  try {
    result = await got.post(`${getUrl('validate', provider)}${type}/${identifier}`, {
      body: xml,
      headers: {
        'Content-type': 'application/echo10+xml'
      }
    });

    if (result.statusCode === 200) {
      return true;
    }
  }
  catch (e) {
    result = e.response;
  }

  const parsed = await new Promise((resolve, reject) => {
    xml2js.parseString(result.body, xmlParseOptions, (err, res) => {
      if (err) reject(err);
      resolve(res);
    });
  });

  throw new ValidationError(
    `Validation was not successful, CMR error message: ${JSON.stringify(parsed.errors.error)}`
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
 * @returns {string} IP address
 */
async function getIp() {
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
 * @param {string} cmrProvider - the CMR provider id
 * @param {string} clientId - the CMR clientId
 * @param {string} username - CMR username
 * @param {string} password - CMR password
 * @returns {Promise.<string>} the token
 */
async function updateToken(cmrProvider, clientId, username, password) {
  // Update the saved ECHO token
  // for info on how to add collections to CMR: https://cmr.earthdata.nasa.gov/ingest/site/ingest_api_docs.html#validate-collection
  let response;

  try {
    response = await got.post(getUrl('token'), {
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
  updateToken,
  validate,
  xmlParseOptions
};
