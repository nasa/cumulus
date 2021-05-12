const { resolve: pathresolve } = require('path');
const router = require('express-promise-router')();
const { render } = require('nunjucks');
const urljoin = require('url-join');
const { randomId } = require('@cumulus/common/test-utils');
const { RecordDoesNotExist } = require('@cumulus/errors');
const { getSecretString } = require('@cumulus/aws-client/SecretsManager');
const { EarthdataLoginClient } = require('@cumulus/earthdata-login-client');

const {
  getConfigurations,
  handleRedirectRequest,
  handleFileRequest,
} = require('../endpoints/distribution');
const { isAccessTokenExpired } = require('../lib/token');

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

  // Public data doesn't need authentication
  if (isPublicRequest(req.path)) {
    req.authorizedMetadata = { userName: 'unauthenticated user' };
    return next();
  }

  const {
    accessTokenModel,
    authClient,
  } = getConfigurations();

  const redirectURLForAuthorizationCode = authClient.getAuthorizationUrl(req.path);
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

const buildOAuthClient = async () => {
  const clientPassword = await getSecretString(
    process.env.oauthClientPasswordSecretName
  );
  const oauthClientConnfig = {
    clientId: process.env.oauthClientId,
    clientPassword,
    earthdataLoginUrl: process.env.oauthHostUrl,
    redirectUri: urljoin(process.env.apiBaseUrl, 'login'),
  };
  if (process.env.oauthProvider === 'earthdata') {
    return new EarthdataLoginClient(oauthClientConnfig);
  }
  // TODO update
  // return new CognitoClient(oauthClientConnfig);
  return new EarthdataLoginClient(oauthClientConnfig);
};

/**
 * Sends a welcome page
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 */
const root = async (req, res) => {
  const oauthClient = await buildOAuthClient();
  const authorizeUrl = oauthClient.getAuthorizationUrl();
  console.log(authorizeUrl);
  const templateVars = { URS_URL: authorizeUrl };
  const rendered = render(pathresolve(__dirname, 'templates/root.html'), templateVars);
  console.log(rendered);
  return res.send(rendered);
};

const locate = (req, res) => res.status(501).end();

const login = async (req, res) => {
  console.log(req);
  console.log(req.cookies);
  console.log(req.query);
  console.log(req.url);

  //TODO
  // from code->accessToken
  // accessToken->userinfo
  // cookie?

  return res.send({ url: req.url });
};

const logout = (req, res) => res.status(501).end();

const profile = (req, res) => res.send('Profile not available.');

const pubkey = (req, res) => res.status(501).end();

const s3Credentials = (req, res) => res.status(501).end();

const s3CredentialsREADME = (req, res) => res.status(501).end();

const version = (req, res) => res.status(501).end();

router.get('/', root);
router.get('/locate', locate);
router.get('/login', login);
router.get('/logout', logout);
router.get('/profile', profile);
router.get('/pubkey', pubkey);
router.get('/redirect', handleRedirectRequest);
router.get('/s3Credentials', s3Credentials);
router.get('/s3CredentialsREADME', s3CredentialsREADME);
router.get('/version', version);

// HEAD /*
// GET /* <- Actual presigned URL
router.get('/*', ensureAuthorizedOrRedirect, handleFileRequest);

module.exports = router;
