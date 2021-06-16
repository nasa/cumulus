const router = require('express-promise-router')();
const get = require('lodash/get');
const { randomId } = require('@cumulus/common/test-utils');
const { RecordDoesNotExist } = require('@cumulus/errors');
const {
  handleLocateBucketRequest,
  handleLoginRequest,
  handleLogoutRequest,
  handleFileRequest,
  handleRootRequest,
} = require('../endpoints/distribution');
const displayS3CredentialInstructions = require('../endpoints/s3credentials-readme');
const { isAccessTokenExpired } = require('../lib/token');
const { handleCredentialRequest } = require('../endpoints/s3credentials');
const {
  getConfigurations,
  handleAuthBearerToken,
  isAuthBearTokenRequest,
  isPublicData,
} = require('../lib/distribution');

const version = require('../endpoints/version');

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

  const {
    accessTokenModel,
    oauthClient,
  } = await getConfigurations();

  const redirectURLForAuthorizationCode = oauthClient.getAuthorizationUrl(req.path);
  const accessToken = req.cookies.accessToken;

  let authorizedMetadata;
  let accessTokenRecord;
  if (accessToken) {
    try {
      accessTokenRecord = await accessTokenModel.get({ accessToken });
      authorizedMetadata = {
        userName: accessTokenRecord.username,
        ...{ userGroups: get(accessTokenRecord, 'tokenInfo.user_groups', []) },
      };
    } catch (error) {
      if (!(error instanceof RecordDoesNotExist)) {
        throw error;
      }
    }
  }

  if (await isPublicData(req.path)) {
    req.authorizedMetadata = {
      userName: 'unauthenticated user',
      ...authorizedMetadata,
    };
    return next();
  }

  if (isAuthBearTokenRequest(req)) {
    return handleAuthBearerToken(req, res, next);
  }

  if (!accessToken || !accessTokenRecord || isAccessTokenExpired(accessTokenRecord)) {
    return res.redirect(307, redirectURLForAuthorizationCode);
  }

  req.authorizedMetadata = { ...authorizedMetadata };
  return next();
}

const profile = (req, res) => res.send('Profile not available.');

router.get('/', handleRootRequest);
router.get('/locate', handleLocateBucketRequest);
router.get('/login', handleLoginRequest);
router.get('/logout', handleLogoutRequest);
router.get('/profile', profile);
router.get('/s3credentials', ensureAuthorizedOrRedirect, handleCredentialRequest);
router.get('/s3credentialsREADME', displayS3CredentialInstructions);
// Use router.use to leverage custom version middleware
router.use('/version', version);

// HEAD /*
// GET /* <- Actual presigned URL
router.get('/*', ensureAuthorizedOrRedirect, handleFileRequest);

module.exports = router;
