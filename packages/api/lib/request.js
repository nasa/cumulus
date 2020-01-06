const log = require('@cumulus/common/log');

const {
  TokenUnauthorizedUserError
} = require('../lib/errors');
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
  } catch (err) {
    log.error('Error caught when checking JWT token', err);
    throw err;
  }

  if (!(await isAuthorizedOAuthUser(username))) {
    throw new TokenUnauthorizedUserError();
  }

  return accessToken;
}

module.exports = {
  verifyJwtAuthorization
};
