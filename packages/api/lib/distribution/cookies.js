const log = require('@cumulus/common/log');
const { createJwtToken, verifyJwtToken, isAccessTokenExpired } = require('../token');

const cookieName = process.env.JWT_COOKIENAME;
// process.env.TOKEN_SECRET should be set
const cookieOptions = { httpOnly: true, secure: true };

/**
 * Extracts and decodes and returns relevant cookies from http headers
 *
 * @param {*} headers - dict of http headers
 * @returns on success dict with keys env value of 'JWT_COOKIENAME' containing decoded
 * jwt, 'urs-user-id', 'urs-access-token' on failure empty dict.
 */
// Extracts and decodes and returns relevant cookies from http headers
// :param headers: dict of http headers
// return: on success dict with keys env value of 'JWT_COOKIENAME' containing decoded
// jwt, 'urs-user-id', 'urs-access-token' on failure empty dict.
// type: dict
function getCookieVars(req) {
  let cookieVars;
  console.log('req.cookies', req.cookies);
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
