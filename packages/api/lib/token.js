const { sign: jwtSign, verify: jwtVerify } = require('jsonwebtoken');

const createJwtToken = ({ accessToken, expirationTime, username, iat }) =>
  jwtSign({
    exp: expirationTime,
    accessToken,
    username,
    ...(iat && { iat }),
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

/**
 * Gets the maximum session duration from environment variable
 * Defaults to 12 hours (43200 seconds) if not set
 *
 * @returns {number} Maximum session duration in seconds
 */
function getMaxSessionDuration() {
  const maxDuration = process.env.MAX_SESSION_DURATION;
  if (maxDuration) {
    const parsed = Number.parseInt(maxDuration, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  // Default to 12 hours
  return 12 * 60 * 60;
}

/**
 * Checks if a session has exceeded the maximum allowed duration
 *
 * @param {Object} decodedToken - the decoded JWT token
 * @param {number} decodedToken.iat - Issued at timestamp in seconds since epoch
 * @returns {boolean} true indicates the session has exceeded max duration
 */
function isSessionExpired(decodedToken) {
  const maxSessionDuration = getMaxSessionDuration();
  const currentTime = Math.floor(Date.now() / 1000);
  const sessionAge = currentTime - decodedToken.iat;
  return sessionAge > maxSessionDuration;
}

module.exports = {
  createJwtToken,
  verifyJwtToken,
  isAccessTokenExpired,
  getMaxSessionDuration,
  isSessionExpired,
};
