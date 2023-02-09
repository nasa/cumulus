// @ts-check
const get = require('lodash/get');

const log = require('@cumulus/common/log');

const {
  TokenUnauthorizedUserError,
} = require('./errors');
const { verifyJwtToken } = require('./token');
const { isAuthorizedOAuthUser } = require('../app/auth');

/**
* typedef {import('express').Request} Request
* typedef {import('express').Response} Response
* typedef {(message?: string, data?: any) => Error } BoomBadRequest
* typedef BoomResponse @extends Response { badRequest: BoomBadRequest }
* typedef {import('express').NextFunction} NextFunction
* BoomError based on https://github.com/hapijs/boom/blob/master/lib/index.js#L69
* and https://github.com/scottcorgan/express-boom/blob/master/index.js#L4
*/

/**
 * @typedef { import("./expressTypes").ExpressRequest } Request
 * @typedef { import("./expressTypes").ExpressResponse } Response
 * @typedef { import("./expressTypes").BoomResponse } BoomResponse
 * @typedef { import("./expressTypes").BoomResponse } BoomBadRequest
 * @typedef { import('boom') } Boom
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
  const requestVersion = Number(req.headers.version);
  if (requestVersion && minVersion <= requestVersion) return true;
  return false;
}

/**
 *
 * @param {BoomResponse} res - Express Response object
 * @param {number} minVersion - Minimum version required to be displayed to user
 * @returns {Boom} -- Boom Error response object
 */
function invalidApiVersion(res, minVersion) {
  return res.boom.badRequest(`This API endpoint requires 'version' header to be set to at least ${minVersion}.  Please ensure your request is compatible with that version of the API and update your request accordingly`);
}

function validateBulkGranulesRequest(req, res, next) {
  const payload = req.body;

  if (!payload.ids && !payload.query) {
    return res.boom.badRequest('One of ids or query is required');
  }

  if (payload.ids && !Array.isArray(payload.ids)) {
    return res.boom.badRequest(`ids should be an array of values, received ${payload.ids}`);
  }

  if (!payload.query && payload.ids && payload.ids.length === 0) {
    return res.boom.badRequest('no values provided for ids');
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
  getFunctionNameFromRequestContext,
  invalidApiVersion,
  isMinVersionApi,
  validateBulkGranulesRequest,
  validateGranuleExecutionRequest,
  verifyJwtAuthorization,
};
