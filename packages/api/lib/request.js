const log = require('@cumulus/common/log');
const { JsonWebTokenError, TokenExpiredError } = require('jsonwebtoken');

const { AccessToken, User } = require('../models');
const {
  TokenUnauthorizedUserError,
  TokenNotFoundError
} = require('../lib/errors');
const {
  AuthorizationFailureResponse,
  InvalidTokenResponse,
  TokenExpiredResponse
} = require('../lib/responses');
const { verifyJwtToken } = require('./token');

const handleRequestAuthorizationError = (err) => {
  if (err instanceof TokenExpiredError) {
    return new TokenExpiredResponse();
  }
  if (err instanceof JsonWebTokenError) {
    return new InvalidTokenResponse();
  }
  if (err instanceof TokenUnauthorizedUserError) {
    return new AuthorizationFailureResponse({
      message: 'User not authorized',
      statusCode: 403
    });
  }
  if (err instanceof TokenNotFoundError) {
    return new InvalidTokenResponse();
  }
}

const verifyRequestAuthorization = async (requestJwtToken) => {
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
  handleRequestAuthorizationError,
  verifyRequestAuthorization
};