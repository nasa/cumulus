const isEmpty = require('lodash/isEmpty');
const { getSecretString } = require('@cumulus/aws-client/SecretsManager');
const { CognitoClient, EarthdataLoginClient } = require('@cumulus/oauth-client');
const { s3 } = require('@cumulus/aws-client/services');
const { randomId } = require('@cumulus/common/test-utils');
const { RecordDoesNotExist } = require('@cumulus/errors');
const { parseS3Uri } = require('@cumulus/aws-client/S3');

const { isLocalApi } = require('./testUtils');
const { AccessToken } = require('../models');
const { isAccessTokenExpired } = require('./token');

// Running API locally will be on http, not https, so cookies
// should not be set to secure for local runs of the API.
const useSecureCookies = () => {
  if (isLocalApi()) {
    return false;
  }
  return true;
};

/**
 * build OAuth client based on environment variables
 *
 * @returns {Object} - OAuthClient object
 */
const buildOAuthClient = async () => {
  if (process.env.OAUTH_CLIENT_PASSWORD === undefined) {
    const clientPassword = await getSecretString(process.env.OAUTH_CLIENT_PASSWORD_SECRET_NAME);
    process.env.OAUTH_CLIENT_PASSWORD = clientPassword;
  }
  const oauthClientConfig = {
    clientId: process.env.OAUTH_CLIENT_ID,
    clientPassword: process.env.OAUTH_CLIENT_PASSWORD,
    loginUrl: process.env.OAUTH_HOST_URL,
    redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT,
  };
  if (process.env.OAUTH_PROVIDER === 'earthdata') {
    return new EarthdataLoginClient(oauthClientConfig);
  }
  return new CognitoClient(oauthClientConfig);
};

/**
 * Returns a configuration object
 *
 * @returns {Object} the configuration object needed to handle requests
 */
async function getConfigurations() {
  const oauthClient = await buildOAuthClient();

  return {
    accessTokenModel: new AccessToken(),
    oauthClient,
    distributionUrl: process.env.DISTRIBUTION_ENDPOINT,
    s3Client: s3(),
  };
}

/**
 * checks the login query and build error messages
 *
 * @param {Object} query - request query parameters
 * @returns {Object} template variables for building response html, empty if no errors
 */
function buildErrorTemplateVars(query) {
  let templateVars = {};
  if (isEmpty(query)) {
    templateVars = {
      contentstring: 'No params',
      title: 'Could Not Login',
      statusCode: 400,
    };
  } else if (query.error) {
    templateVars = {
      contentstring: `An error occurred while trying to log. OAuth provider says: "${query.error}".`,
      title: 'Could Not Login',
      statusCode: 400,
    };
  } else if (query.code === undefined) {
    templateVars = {
      contentstring: 'Did not get the required CODE from OAuth provider',
      title: 'Could not login.',
      statusCode: 400,
    };
  }
  return templateVars;
}

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
  const { Bucket } = parseS3Uri(path.replace(/^\//, ''));
  return Bucket;
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

module.exports = {
  buildErrorTemplateVars,
  ensureAuthorizedOrRedirect,
  getConfigurations,
  useSecureCookies,
  bucketNameFromPath,
  isPublicRequest,
};
