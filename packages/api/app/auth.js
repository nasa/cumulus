'use strict';

const {
  JsonWebTokenError,
  TokenExpiredError,
} = require('jsonwebtoken');

const { getJsonS3Object } = require('@cumulus/aws-client/S3');
const log = require('@cumulus/common/log');

const { ensureLaunchpadAPIAuthorized, launchpadProtectedAuth } = require('./launchpadAuth');
const { AccessToken } = require('../lib/access-tokens');
const { verifyJwtToken } = require('../lib/token');

const authorizedOAuthUsersKey = () =>
  `${process.env.stackName}/api/authorized_oauth_users.json`;

const getAuthorizedOAuthUsers = () =>
  getJsonS3Object(process.env.system_bucket, authorizedOAuthUsersKey());

const isAuthorizedOAuthUser = (username) =>
  getAuthorizedOAuthUsers()
    .then((authorizedUsers) => authorizedUsers.includes(username));

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
  if (process.env.auth_mode === 'private') {
    return next();
  }

  if (launchpadProtectedAuth()) {
    return ensureLaunchpadAPIAuthorized(req, res, next);
  }

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

  try {
    const { username: userName, accessToken } = verifyJwtToken(jwtToken);

    const accessTokenModel = new AccessToken();

    if (!(await isAuthorizedOAuthUser(userName))) {
      return res.boom.unauthorized('User not authorized');
    }

    await accessTokenModel.get({ accessToken });

    // Adds additional metadata that authorized endpoints can access.
    req.authorizedMetadata = { userName };
    return next();
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      return res.boom.unauthorized('Access token has expired');
    }

    if (error instanceof JsonWebTokenError) {
      return res.boom.unauthorized('Invalid access token');
    }

    log.error('Authorization error:', error);
    return res.boom.unauthorized('User not authorized');
  }
}

module.exports = {
  authorizedOAuthUsersKey,
  ensureAuthorized,
  isAuthorizedOAuthUser,
};
