const { sign: jwtSign, verify: jwtVerify } = require('jsonwebtoken');
const {
  JsonWebTokenError,
  TokenExpiredError,
} = require('jsonwebtoken');
const { TokenUnauthorizedUserError } = require('./errors');

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

/**
 * Verifies and validates a JWT token from a request
 *
 * Extracts the token from request body, verifies its signature, and checks
 * session validity. This consolidates common validation logic used by both
 * OAuth and SAML refresh endpoints.
 *
 * @param {Object} request - the request object containing the token in body.token
 * @returns {Promise<Object>} the decoded token object
 * @throws {Error} with property 'noToken' if token is missing
 * @throws {Error} with property 'jwtError' if token verification fails
 * @throws {Error} with property 'sessionExpired' if session duration exceeded
 */
function verifyAndDecodeTokenFromRequest(request) {
  const get = require('lodash/get');
  const requestJwtToken = get(request, 'body.token');

  if (!requestJwtToken) {
    const error = new Error('Request requires a token');
    error.noToken = true;
    throw error;
  }

  let decodedToken;
  try {
    decodedToken = verifyJwtToken(requestJwtToken);
  } catch (error) {
    const err = new Error(`JWT verification failed: ${error.message}`);
    err.jwtError = error;
    throw err;
  }

  // Check if the session has exceeded the maximum duration
  if (isSessionExpired(decodedToken)) {
    const error = new Error('Session has exceeded maximum duration');
    error.sessionExpired = true;
    throw error;
  }

  return decodedToken;
}

/**
 * Handle API response for JWT verification errors
 *
 * Shared error handler for JWT verification failures across all authentication methods.
 *
 * @param {Error} err - error thrown by JWT verification
 * @param {Object} response - an express response object
 * @returns {Object} the express response object
 */
function handleJwtVerificationError(err, response) {
  if (err instanceof TokenExpiredError) {
    return response.boom.unauthorized('Access token has expired');
  }
  if (err instanceof JsonWebTokenError) {
    return response.boom.unauthorized('Invalid access token');
  }
  if (err instanceof TokenUnauthorizedUserError) {
    return response.boom.unauthorized('User not authorized');
  }
  throw err;
}

/**
 * Refreshes an access token record and returns a new JWT token
 *
 * Shared logic for token refresh across different authentication methods (OAuth, SAML, etc).
 * Handles token verification, expiration checks, database updates, and JWT creation.
 *
 * @param {Object} decodedToken - the decoded JWT token from the request
 * @param {string} decodedToken.accessToken - the access token
 * @param {string} decodedToken.username - the username
 * @param {number} decodedToken.iat - Issued at timestamp
 * @param {AccessToken} accessTokenModel - instance of AccessToken model
 * @param {number} [extensionSeconds=43200] - seconds to extend token expiration (default: 12 hours)
 * @returns {Promise<string>} the new JWT token
 */
async function refreshTokenAndJwt(
  decodedToken,
  accessTokenModel,
  extensionSeconds = 12 * 60 * 60
) {
  const { accessToken, username, iat } = decodedToken;

  // Fetch the access token record from database
  let accessTokenRecord;
  try {
    accessTokenRecord = await accessTokenModel.get({ accessToken });
  } catch (error) {
    const { RecordDoesNotExist } = require('@cumulus/errors');
    if (error instanceof RecordDoesNotExist) {
      throw new Error('Invalid access token');
    }
    throw error;
  }

  // Use existing token value and extend expiration time
  const newAccessToken = accessTokenRecord.accessToken;

  // Extend expiration time by the specified amount (default: 12 hours)
  // If expirationTime is undefined, use current time as base
  const baseTime = accessTokenRecord.expirationTime || Math.floor(Date.now() / 1000);
  const expirationTime = baseTime + extensionSeconds;

  // Update the existing record with new expiration time
  await accessTokenModel.update(
    { accessToken: accessTokenRecord.accessToken },
    { expirationTime }
  );

  // Preserve the original iat from the token to prevent indefinite authentication
  const jwtToken = createJwtToken({
    accessToken: newAccessToken,
    username,
    expirationTime,
    iat,
  });

  return jwtToken;
}

module.exports = {
  createJwtToken,
  verifyJwtToken,
  isAccessTokenExpired,
  getMaxSessionDuration,
  isSessionExpired,
  refreshTokenAndJwt,
  verifyAndDecodeTokenFromRequest,
  handleJwtVerificationError,
};
