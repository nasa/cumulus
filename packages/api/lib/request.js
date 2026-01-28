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
 * @typedef { import("express").NextFunction } NextFunction
 */

/**
 * @typedef {Object} GranuleExecutionPayload
 * @property {string[]} [granules] - List of granule IDs
 * @property {Object} [query] - lasticsearch query object (Cloud Metrics)
 * @property {string} [index] - Elasticsearch index name (required if query is provided)
 * @property {string} [granuleInventoryReportName] - Logical name of a granule inventory
 *   report. The name is resolved via the database to obtain the report’s S3 URI.
 * @property {string} [s3GranuleIdInputFile] - S3 URI of an input file where each record
 *   starts with a granuleId and may include additional fields.
 * @property {number} [batchSize] - Batch size for yielded granuleIds. Default to 100.
 */

/**
 * Verify the validity and access of JWT for request authorization.
 *
 * @param {string} requestJwtToken - The JWT token used for request authorization
 * @throws {JsonWebTokenError} - thrown if the JWT is invalid
 * @throws {TokenExpiredError} - thown if the JWT is expired
 * @throws {TokenUnauthorizedUserError} - thrown if the user is not authorized

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

/**
 * Validate granules field in the payload
 *
 * @param {GranuleExecutionPayload} payload - payload
 * @returns {string|undefined} Error message if validation fails, otherwise null
 */
function validateGranulesInPayload(payload) {
  const {
    granules,
    query,
    granuleInventoryReportName,
    s3GranuleIdInputFile,
  } = payload;

  if (!granules) return undefined;

  if (!Array.isArray(granules) || granules.some((g) => !isString(g))) {
    return `granules should be an array of values, received ${granules}`;
  }

  const hasAlternateInput =
        query || granuleInventoryReportName || s3GranuleIdInputFile;
  if (granules.length === 0 && !hasAlternateInput) {
    return 'granules is empty and no alternative input source was provided';
  }

  return undefined;
}

/**
 * Validate the payload for a granule execution request.
 *
 * @param {GranuleExecutionPayload} payload - Request body payload
 * @returns {string|undefined} Error message if validation fails, otherwise null
 */
function validateGranuleExecutionPayload(payload) {
  const {
    granules,
    query,
    granuleInventoryReportName,
    s3GranuleIdInputFile,
    index,
  } = payload;

  if (!(granules || query || granuleInventoryReportName || s3GranuleIdInputFile)) {
    return 'One of granules, query, granuleInventoryReportName or s3GranuleIdInputFile is required';
  }

  const granulesError = validateGranulesInPayload(payload);
  if (granulesError) return granulesError;

  if (query) {
    const metricsConfigured
      = process.env.METRICS_ES_HOST
      && process.env.METRICS_ES_USER
      && process.env.METRICS_ES_PASS;

    if (!metricsConfigured) {
      return 'ELK Metrics stack not configured';
    }

    if (!index) {
      return 'Index is required if query is sent';
    }
  }

  return undefined;
}

/**
 * Express middleware that validates a bulk granule request.
 *
 * @param {Request} req
 * @param {Response} res
 * @param {NextFunction} next
 * @returns {void}
 */
function validateBulkGranulesRequest(req, res, next) {
  const error = validateGranuleExecutionPayload(req.body);
  if (error) return res.boom.badRequest(error);
  return next();
}

/**
 * Express middleware that validates a granule execution request.
 *
 * @param {Request} req
 * @param {Response} res
 * @param {NextFunction} next
 * @returns {void}
 */
function validateGranuleExecutionRequest(req, res, next) {
  const error = validateGranuleExecutionPayload(req.body);
  if (error) return res.boom.badRequest(error);
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
