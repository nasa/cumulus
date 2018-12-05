const log = require('@cumulus/common/log');

const { AccessToken, User } = require('../models');
const {
  TokenUnauthorizedUserError,
  TokenNotFoundError
} = require('../lib/errors');
const { verifyJwtToken } = require('./token');

/**
 * Verify the validity and access of JWT for request authorization.
 *
 * @param {string} requestJwtToken - The JWT token used for request authorization
 *
 * @throws {JsonWebTokenError} - thrown if the JWT is invalid
 * @throws {TokenExpiredError} - thown if the JWT is expired
 * @throws {TokenUnauthorizedUserError} - thrown if the user is not authorized
 * @throws {TokenNotFoundError} - thrown if the access token is not found
 *
 * @returns {Object} accessTokenRecord - The access token record object.
 */
async function verifyJwtAuthorization (requestJwtToken) {
  let accessToken;
  let username;
  try {
    ({ accessToken, username } = verifyJwtToken(requestJwtToken));
  }
  catch (err) {
    log.error('Error caught when checking JWT token', err);
    throw err;
  }

  const userModel = new User();
  try {
    await userModel.get({ userName: username });
  }
  catch (err) {
    if (err.name === 'RecordDoesNotExist') {
      throw new TokenUnauthorizedUserError();
    }
  }

  const accessTokenModel = new AccessToken();

  let accessTokenRecord;
  try {
    accessTokenRecord = await accessTokenModel.get({ accessToken });
  }
  catch (err) {
    if (err.name === 'RecordDoesNotExist') {
      throw new TokenNotFoundError();
    }
  }

  return accessTokenRecord;
};

module.exports = {
  verifyJwtAuthorization
};