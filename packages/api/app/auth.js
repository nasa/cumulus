
'use strict';

const {
  JsonWebTokenError,
  TokenExpiredError
} = require('jsonwebtoken');
const { User, AccessToken } = require('../models');
const { verifyJwtToken } = require('../lib/token');

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
  // Verify that the Authorization header was set in the request
  const authorizationKey = req.headers.authorization;
  if (!authorizationKey) {
    return res.boom.unauthorized('Authorization header missing');
  }
  // Parse the Authorization header
  const [scheme, jwtToken] = req.headers.authorization.trim().split(/\s+/);

  // Verify that the Authorization type was "Bearer"
  if (scheme !== 'Bearer') {
    return res.boom.unauthorized('Authorization scheme must be Bearer');
  }

  if (!jwtToken) {
    return res.boom.unauthorized('Missing token');
  }

  let userName;
  let accessToken;
  try {
    ({ username: userName, accessToken } = verifyJwtToken(jwtToken));

    const userModel = new User();
    const access = new AccessToken();

    await userModel.get({ userName });
    await access.get({ accessToken });
    // Adds additional metadata that authorized endpoints can access.
    req.authorizedMetadata = { userName };
    return next();
  }
  catch (error) {
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
