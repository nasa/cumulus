const router = require('express-promise-router')();

const { randomId } = require('@cumulus/common/test-utils');
const { RecordDoesNotExist } = require('../lib/errors');
const {
  getConfigurations,
  handleRedirectRequest,
  handleCredentialRequest,
  handleFileRequest
} = require('../endpoints/distribution');

/**
 * Checks if the token is expired
 *
 * @param {Object} accessTokenRecord - the access token record
 * @returns {boolean} true indicates the token is expired
 */
function isAccessTokenExpired(accessTokenRecord) {
  return accessTokenRecord.expirationTime < Date.now();
}

/**
 * Reads the input path and determines if this is a request for public data
 * or not.
 *
 * @param {string} path - req.path paramater
 * @returns {boolean} - whether this request goes to a public bucket
 */
function isPublicRequest(path) {
  const publicBuckets = process.env.public_buckets.split(',');
  const requestedBucket = path.split('/').filter((d) => d).shift();
  return publicBuckets.includes(requestedBucket);
}

/**
 * Ensure request is authorized through EarthdataLogin or redirect to become so.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @param {Function} next - express middleware callback function
 * @returns {Promise<Object>} - promise of an express response object
 */
async function ensureAuthorizedOrRedirect(req, res, next) {
  // Skip authentication for debugging purposes.
  if (process.env.FAKE_AUTH) {
    req.authorizedMetadata = { userName: randomId('username') };
    return next();
  }

  // Public data doesn't need authentication
  if (isPublicRequest(req.path)) {
    req.authorizedMetadata = { userName: 'publicAccess' };
    return next();
  }

  const {
    accessTokenModel,
    authClient
  } = getConfigurations();

  const redirectURLForAuthorizationCode = authClient.getAuthorizationUrl(req.path);
  const accessToken = req.cookies.accessToken;

  if (!accessToken) return res.redirect(307, redirectURLForAuthorizationCode);

  let accessTokenRecord;
  try {
    accessTokenRecord = await accessTokenModel.get({ accessToken });
  }
  catch (err) {
    if (err instanceof RecordDoesNotExist) {
      return res.redirect(307, redirectURLForAuthorizationCode);
    }

    throw err;
  }

  if (isAccessTokenExpired(accessTokenRecord)) {
    return res.redirect(307, redirectURLForAuthorizationCode);
  }

  req.authorizedMetadata = { userName: accessTokenRecord.username };
  return next();
}

router.get('/redirect', handleRedirectRequest);
router.get('/s3credentials', ensureAuthorizedOrRedirect, handleCredentialRequest);
router.get('/*', ensureAuthorizedOrRedirect, handleFileRequest);

module.exports = router;
