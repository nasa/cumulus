const log = require('@cumulus/common/log');
const { createJwtToken, verifyJwtToken, isAccessTokenExpired } = require('../token');

const cookieName = process.env.JWT_COOKIENAME;
// process.env.TOKEN_SECRET should be set
const cookieOptions = { httpOnly: true, secure: true };

/**
 * Extracts and decodes and returns relevant cookies from request
 *
 * @param {Object} req - express request object
 * @returns {Object} on success the decoded jwt object of env value of 'JWT_COOKIENAME',
 * on failure undefined
 */
function getCookieVars(req) {
  let cookieVars;
  try {
    if (req.cookies[cookieName]) {
      cookieVars = verifyJwtToken(req.cookies[cookieName]);
      if (isAccessTokenExpired(cookieVars)) {
        log.debug('accessToken is expired');
        cookieVars = undefined;
      }
    } else {
      log.debug(`could not find cookie ${cookieName} in getCookieVars`);
    }
  } catch (error) {
    log.debug('Key error trying to get cookie vars:', error);
  }
  return cookieVars;
}

/**
 * Creates and sets cookie on response
 *
 * @param {Object} res - express response object
 * @param {Object} cookieVars - cookie value
 * @param {number} expirationTime - expirationTime in seconds
 */
function setCookieVars(res, cookieVars, expirationTime) {
  log.debug('setCookieVars');
  const token = createJwtToken({ ...cookieVars, expirationTime });
  res.cookie(cookieName, token,
    {
      expires: new Date(expirationTime * 1000),
      ...cookieOptions,
    });
}

function clearCookie(res) {
  res.clearCookie(cookieName, cookieOptions);
}

module.exports = {
  getCookieVars,
  setCookieVars,
  clearCookie,
};
