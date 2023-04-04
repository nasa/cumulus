const get = require('lodash/get');

const log = require('@cumulus/common/log');

const {
  TokenUnauthorizedUserError,
} = require('./errors');
const { verifyJwtToken } = require('./token');
const { isAuthorizedOAuthUser } = require('../app/auth');

/**
 * Verify the validity and access of JWT for request authorization.
 *
 * @param {string} requestJwtToken - The JWT token used for request authorization
 * @throws {JsonWebTokenError} - thrown if the JWT is invalid
 * @throws {TokenExpiredError} - thown if the JWT is expired
 * @throws {TokenUnauthorizedUserError} - thrown if the user is not authorized
 *
 * @returns {string} accessToken - The access token from the OAuth provider
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

// TODO no tests for this
function validateBulkGranulesRequest(req, res, next) {
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

    payload.granules.forEach((granule) => {
      const granuleString = JSON.stringify(granule);
      if (!granule.collectionId) {
        return res.boom.badRequest(`no collectionId provided for ${granuleString}`);
      }
      if (!granule.granuleId) {
        return res.boom.badRequest(`no granuleId provided for ${granuleString}`);
      }
      return true;
    });
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
  validateBulkGranulesRequest,
  validateGranuleExecutionRequest,
  verifyJwtAuthorization,
  getFunctionNameFromRequestContext,
};
