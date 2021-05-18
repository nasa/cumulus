const { resolve: pathresolve } = require('path');
const get = require('lodash/get');
const isEmpty = require('lodash/isEmpty');
const urljoin = require('url-join');
const router = require('express-promise-router')();
const { render } = require('nunjucks');
const log = require('@cumulus/common/log');
const { randomId } = require('@cumulus/common/test-utils');
const { RecordDoesNotExist } = require('@cumulus/errors');
const { AccessToken } = require('../models');

const {
  getConfigurations,
  handleRedirectRequest,
  handleFileRequest,
  useSecureCookies,
} = require('../endpoints/distribution');
const { isAccessTokenExpired } = require('../lib/token');
const { buildOAuthClient, checkLoginQueryErrors, getAccessToken, getProfile } = require('../lib/distribution');

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

/**
 * Sends a welcome page
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 */
const root = async (req, res) => {
  const accessToken = req.cookies.accessToken;
  let accessTokenRecord;
  if (accessToken) {
    try {
      accessTokenRecord = await new AccessToken().get({ accessToken });
    } catch (error) {
      if ((error instanceof RecordDoesNotExist) === false) {
        throw error;
      }
    }
  }

  const templateVars = {
    title: 'Welcome',
    profile: get(accessTokenRecord, 'tokenInfo'),
    logoutURL: urljoin(process.env.API_BASE_URL, 'logout'),
  };

  if (!accessToken || !accessTokenRecord) {
    const authorizeUrl = (await buildOAuthClient()).getAuthorizationUrl(req.path);
    templateVars.URL = authorizeUrl;
  }

  const rendered = render(pathresolve(__dirname, 'templates/root.html'), templateVars);
  return res.send(rendered);
};

const locate = (req, res) => res.status(501).end();

/**
 * login endpoint
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} - promise of an express response object
 */
async function login(req, res) {
  const { code, state } = req.query;
  const errorTemplate = pathresolve(__dirname, 'templates/error.html');
  log.debug('the query params:', req.query);
  const templateVars = checkLoginQueryErrors(req.query);
  if (!isEmpty(templateVars) && templateVars.statusCode >= 400) {
    const rendered = render(errorTemplate, templateVars);
    return res.type('.html').status(templateVars.statusCode).send(rendered);
  }

  try {
    log.debug('pre getAccessToken() with query params:', req.query);
    const accessTokenResponse = await getAccessToken(code);
    log.debug('getAccessToken:', accessTokenResponse);

    const userProfile = await getProfile(accessTokenResponse);
    log.debug('Got the user profile: ', userProfile);

    // expirationTime is in seconds whereas Date is expecting milliseconds
    const expirationTime = accessTokenResponse.expirationTime * 1000;
    await new AccessToken().create({
      accessToken: accessTokenResponse.accessToken,
      expirationTime,
      refreshToken: accessTokenResponse.refreshToken,
      username: accessTokenResponse.username,
      tokenInfo: userProfile,
    });

    return res
      .cookie(
        'accessToken',
        accessTokenResponse.accessToken,
        {
          expires: new Date(expirationTime),
          httpOnly: true,
          secure: useSecureCookies(),
        }
      )
      .status(307)
      .set({ Location: urljoin(process.env.API_BASE_URL, state || '') })
      .send('Redirecting');
  } catch (error) {
    log.error('Error occurred while trying to login:', error);
    const vars = {
      contentstring: `There was a problem talking to OAuth provider, ${error.message}`,
      title: 'Could Not Login',
      statusCode: 401,
    };
    const rendered = render(errorTemplate, vars);
    return res.type('.html').status(401).send(rendered);
  }
}

/**
 * logout endpoint
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} - promise of an express response object
 */
const logout = async (req, res) => {
  const accessToken = req.cookies.accessToken;
  const authorizeUrl = (await buildOAuthClient()).getAuthorizationUrl();
  res.clearCookie('accessToken',
    {
      httpOnly: true,
      secure: useSecureCookies(),
    });
  const templateVars = {
    title: 'Logged Out',
    contentstring: accessToken ? 'You are logged out.' : 'No active login found.',
    URL: authorizeUrl,
    logoutURL: urljoin(process.env.API_BASE_URL, 'logout'),
  };
  const rendered = render(pathresolve(__dirname, 'templates/root.html'), templateVars);
  return res.send(rendered);
};

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
