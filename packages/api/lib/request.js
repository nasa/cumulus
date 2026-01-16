// @ts-check

const get = require('lodash/get');
const isString = require('lodash/isString');

const log = require('@cumulus/common/log');

const {
  TokenUnauthorizedUserError,
} = require('./errors');
const { verifyJwtToken } = require('./token');
const { isAuthorizedOAuthUser } = require('../app/auth');

/**
 * @typedef { import("express").Request } Request
 * @typedef { import("express").Response } Response
 */

/**
 * Verify the validity and access of JWT for request authorization.
 *
 * @param {string} requestJwtToken - The JWT token used for request authorization
 * @throws {JsonWebTokenError} - thrown if the JWT is invalid
 * @throws {TokenExpiredError} - thown if the JWT is expired
 * @throws {TokenUnauthorizedUserError} - thrown if the user is not authorized
 *
 * @returns {Promise<string>} accessToken - The access token from the OAuth provider
 */
async function verifyJwtAuthorization(requestJwtToken) {
  let accessToken;
  let username;
  try {
    ({ accessToken, username } = verifyJwtToken(requestJwtToken));
  } catch (error) {
    log.error('Error caught when checking JWT token', error);
    throw error;
  }

  if (!(await isAuthorizedOAuthUser(username))) {
    throw new TokenUnauthorizedUserError();
  }

  return accessToken;
}

/**
* Validate request has header matching expected minimum version
* @param {Request} req - express Request object
* @param {number} minVersion - Minimum API version to allow
* @returns {boolean}
*/
function isMinVersionApi(req, minVersion) {
  const requestVersion = Number(req.headers['cumulus-api-version']);
  return Number.isFinite(requestVersion) && minVersion <= requestVersion;
}

function validateBulkGranulesRequest(req, res, next) {
  // TODO no tests for this
  const payload = req.body;

  if (!payload.granules && !payload.query) {
    return res.boom.badRequest('One of granules or query is required');
  }

  if (payload.granules && !Array.isArray(payload.granules)) {
    return res.boom.badRequest(`granules should be an array of values, received ${payload.granules}`);
  }

  if (!payload.query && payload.granules && payload.granules.length === 0) {
    return res.boom.badRequest('no values provided for granules');
  }

  if (payload.query
    && !(process.env.METRICS_ES_HOST
        && process.env.METRICS_ES_USER
        && process.env.METRICS_ES_PASS)
  ) {
    return res.boom.badRequest('ELK Metrics stack not configured');
  }

  if (payload.query && !payload.index) {
    return res.boom.badRequest('Index is required if query is sent');
  }

  return next();
}

function validateGranuleExecutionRequest(req, res, next) {
  const payload = req.body;

  if (!payload.granules && !payload.query) {
    return res.boom.badRequest('One of granules or query is required');
  }

  if (payload.granules) {
    if (!Array.isArray(payload.granules)) {
      return res.boom.badRequest(`granules should be an array of values, received ${payload.granules}`);
    }

    if (!payload.query && payload.granules.length === 0) {
      return res.boom.badRequest('no values provided for granules');
    }

    if (payload.granules.some((g) => !isString(g))) {
      return res.boom.badRequest(`granules must be an array of strings, received ${payload.granules}`);
    }
  } else {
    if (payload.query
    && !(process.env.METRICS_ES_HOST
        && process.env.METRICS_ES_USER
        && process.env.METRICS_ES_PASS)
    ) {
      return res.boom.badRequest('ELK Metrics stack not configured');
    }
    if (payload.query && !payload.index) {
      return res.boom.badRequest('Index is required if query is sent');
    }
  }
  return next();
}

function getFunctionNameFromRequestContext(req) {
  return get(req, 'apiGateway.context.functionName');
}

module.exports = {
  getFunctionNameFromRequestContext,
  isMinVersionApi,
  validateBulkGranulesRequest,
  validateGranuleExecutionRequest,
  verifyJwtAuthorization,
};
