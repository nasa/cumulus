const log = require('@cumulus/common/log');

const { User } = require('../models');
const {
  TokenUnauthorizedUserError
} = require('../lib/errors');
const { verifyJwtToken } = require('./token');

/**
 * Verify the validity and access of JWT for request authorization.
 *
 * @param {string} requestJwtToken - The JWT token used for request authorization
 * @param {Object} params - additional parameters
 * @param {string} params.usersTable - The name of the DynamoDB Users table
 *
 * @throws {JsonWebTokenError} - thrown if the JWT is invalid
 * @throws {TokenExpiredError} - thown if the JWT is expired
 * @throws {TokenUnauthorizedUserError} - thrown if the user is not authorized
 *
 * @returns {string} accessToken - The access token from the OAuth provider
 */
async function verifyJwtAuthorization(requestJwtToken, params = {}) {
  let accessToken;
  let username;
  try {
    ({ accessToken, username } = verifyJwtToken(requestJwtToken));
  } catch (err) {
    log.error('Error caught when checking JWT token', err);
    throw err;
  }

  const userModel = new User(params);
  try {
    await userModel.get({ userName: username });
  } catch (err) {
    if (err.name === 'RecordDoesNotExist') {
      throw new TokenUnauthorizedUserError();
    }
  }

  return accessToken;
}

module.exports = {
  verifyJwtAuthorization
};
