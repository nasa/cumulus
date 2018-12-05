const log = require('@cumulus/common/log');

const { AccessToken, User } = require('../models');
const {
  TokenUnauthorizedUserError,
  TokenNotFoundError
} = require('../lib/errors');
const { verifyJwtToken } = require('./token');

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
  verifyRequestAuthorization
};