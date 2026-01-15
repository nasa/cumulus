const { sign: jwtSign, verify: jwtVerify } = require('jsonwebtoken');

const createJwtToken = ({ accessToken, expirationTime, username }) =>
  jwtSign({
    exp: expirationTime,
    accessToken,
    username,
  }, process.env.TOKEN_SECRET, {
    algorithm: 'HS256',
  });

const verifyJwtToken = (jwtToken, params = {}) => {
  const options = { algorithms: ['HS256'], ...params };
  return jwtVerify(jwtToken, process.env.TOKEN_SECRET, options);
};

/**
 * Checks if the access token is expired
 *
 * @param {Object} accessTokenRecord - the access token record
 * @param {number} accessTokenRecord.expirationTime
 *   Expiration time of the access token, in seconds since the epoch
 * @returns {boolean} true indicates the token is expired
 */
function isAccessTokenExpired({ expirationTime }) {
  return ((Date.now() / 1000) > expirationTime);
}

module.exports = {
  createJwtToken,
  verifyJwtToken,
  isAccessTokenExpired,
};
