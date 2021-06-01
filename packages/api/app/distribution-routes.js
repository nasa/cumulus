const router = require('express-promise-router')();
const { randomId } = require('@cumulus/common/test-utils');
const { RecordDoesNotExist } = require('@cumulus/errors');

const {
  handleLoginRequest,
  handleLogoutRequest,
  handleFileRequest,
  handleRootRequest,
} = require('../endpoints/distribution');
const displayS3CredentialInstructions = require('../endpoints/s3credentials-readme');
const { isAccessTokenExpired } = require('../lib/token');
const { handleCredentialRequest } = require('../endpoints/s3credentials');
const { getConfigurations } = require('../lib/distribution');

const version = require('../endpoints/version');

/**
 * Helper function to pull bucket out of a path string.
 * Will ignore leading slash.
 * "/bucket/key" -> "bucket"
 * "bucket/key" -> "bucket"
 *
 * @param {string} path - express request path parameter
 * @returns {string} the first part of a path which is our bucket name
 */
function bucketNameFromPath(path) {
  return path.split('/').filter((d) => d).shift();
}

/**
 * Reads the input path and determines if this is a request for public data
 * or not.
 *
 * @param {string} path - req.path paramater
 * @returns {boolean} - whether this request goes to a public bucket
 */
function isPublicRequest(path) {
  try {
    const publicBuckets = process.env.public_buckets.split(',');
    const requestedBucket = bucketNameFromPath(path);
    return publicBuckets.includes(requestedBucket);
  } catch (error) {
    return false;
  }
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

  if (isPublicRequest(req.path)) {
    req.authorizedMetadata = { userName: 'unauthenticated user' };
    return next();
  }

  const {
    accessTokenModel,
    oauthClient,
  } = await getConfigurations();

  const redirectURLForAuthorizationCode = oauthClient.getAuthorizationUrl(req.path);
  const accessToken = req.cookies.accessToken;

  if (!accessToken) return res.redirect(307, redirectURLForAuthorizationCode);

  let accessTokenRecord;
  try {
    accessTokenRecord = await accessTokenModel.get({ accessToken });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.redirect(307, redirectURLForAuthorizationCode);
    }

    throw error;
  }

  if (isAccessTokenExpired(accessTokenRecord)) {
    return res.redirect(307, redirectURLForAuthorizationCode);
  }

  req.authorizedMetadata = { userName: accessTokenRecord.username };
  return next();
}

const locate = (req, res) => res.status(501).end();

const profile = (req, res) => res.send('Profile not available.');

const pubkey = (req, res) => res.status(501).end();

router.get('/', handleRootRequest);
router.get('/locate', locate);
router.get('/login', handleLoginRequest);
router.get('/logout', handleLogoutRequest);
router.get('/profile', profile);
router.get('/pubkey', pubkey);
router.get('/s3Credentials', ensureAuthorizedOrRedirect, handleCredentialRequest);
router.get('/s3CredentialsREADME', displayS3CredentialInstructions);
// Use router.use to leverage custom version middleware
router.use('/version', version);

// HEAD /*
// GET /* <- Actual presigned URL
router.get('/*', ensureAuthorizedOrRedirect, handleFileRequest);

module.exports = router;
