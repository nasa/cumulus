'use strict';

const {
  JsonWebTokenError,
  TokenExpiredError
} = require('jsonwebtoken');
const { ensureLaunchpadAPIAuthorized, launchpadProtectedAuth } = require('./launchpadAuth');
const { User, AccessToken } = require('../models');
const { verifyJwtToken } = require('../lib/token');

/**
 * Verify that the Authorization header was set in the request
 *
 * @param {string} authorizationHeader - request authorization header
 * @returns {string} jwtToken
 * @throws {Error} header validation error (with appropriate message)
 */
function validateAuthHeader(authorizationHeader) {
  if (!authorizationHeader) {
    throw new Error('Authorization header missing');
  }
  // Parse the Authorization header
  const [scheme, jwtToken] = authorizationHeader.trim().split(/\s+/);

  // Verify that the Authorization type was "Bearer"
  if (scheme !== 'Bearer') {
    throw new Error('Authorization scheme must be Bearer');
  }

  if (!jwtToken) {
    throw new Error('Missing token');
  }
  return jwtToken;
}

/**
 * An express middleware that checks if an incoming express
 * request is authenticated
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @param {Function} next - express middleware callback function
 * @returns {Promise<Object>} - promise of an express response object
 */
async function ensureAuthorized(req, res, next) {
  let jwtToken;
  try {
    jwtToken = validateAuthHeader(req.headers.authorization);
  } catch (e) {
    return res.boom.unauthorized(e.message);
  }

  let userName;
  let accessToken;
  try {
    ({ username: userName, accessToken } = verifyJwtToken(jwtToken));

    const userModel = new User();
    const access = new AccessToken();

    if (!launchpadProtectedAuth()) {
      // Only verify user if we're not launchpad protected
      await userModel.get({ userName });
    }
    await access.get({ accessToken });
    // Adds additional metadata that authorized endpoints can access.
    req.authorizedMetadata = { userName };
    return next();
  } catch (error) {
    if (launchpadProtectedAuth()
        && error instanceof JsonWebTokenError
        && error.message === 'jwt malformed') {
      return ensureLaunchpadAPIAuthorized(req, res, next);
    }
    if (error instanceof TokenExpiredError) {
      return res.boom.unauthorized('Access token has expired');
    }
    if (error instanceof JsonWebTokenError) {
      return res.boom.forbidden('Invalid access token');
    }
    return res.boom.unauthorized('User not authorized');
  }
}

module.exports = {
  ensureAuthorized
};
