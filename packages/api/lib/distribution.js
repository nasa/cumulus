const get = require('lodash/get');
const isEmpty = require('lodash/isEmpty');
const log = require('@cumulus/common/log');
const { removeNilProperties } = require('@cumulus/common/util');
const { getSecretString } = require('@cumulus/aws-client/SecretsManager');
const { CognitoClient, EarthdataLoginClient } = require('@cumulus/oauth-client');
const { s3 } = require('@cumulus/aws-client/services');
const { randomId } = require('@cumulus/common/test-utils');
const { RecordDoesNotExist } = require('@cumulus/errors');

const { isLocalApi } = require('./testUtils');
const { isAccessTokenExpired } = require('./token');
const { AccessToken } = require('../models');
const { getBucketMap, isPublicBucket, processFileRequestPath } = require('./bucketMapUtils');

const BEARER_TOKEN_REGEX = new RegExp('^Bearer ([-a-zA-Z0-9._~+/]+)$', 'i');

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
 * @returns {Promise<Object>} - OAuthClient object
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
 * Reads the input path and determines if this is a request for public data
 * or not.
 *
 * @param {string} path - req.path paramater
 * @returns {Promise<boolean>} - whether this request goes to a public bucket
 */
async function isPublicData(path) {
  try {
    const bucketMap = await getBucketMap();
    const { bucket, key } = processFileRequestPath(path, bucketMap);
    return bucket && await isPublicBucket(bucketMap, bucket, key);
  } catch (error) {
    return false;
  }
}

/**
 * Returns a configuration object
 *
 * @returns {Promise<Object>} the configuration object needed to handle requests
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
 * @returns {Object} - template variables for building response html, empty if no errors
 */
function buildLoginErrorTemplateVars(query) {
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
 * check if a shared token is used as an Authorization method
 *
 * @param {Object} req - express request object
 * @returns {boolean} - return true if a Bearer token is present in the request header
 */
function isAuthBearTokenRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const match = authHeader.match(BEARER_TOKEN_REGEX);
    if (match && match.length >= 2) return true;
  }
  return false;
}

/**
 * Validates authorization token and retrieves token information from OAuth provider.
 * If the token is not valid, redirects to the authorization url.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @param {Function} next - express middleware callback function
 * @returns {Promise<Object>} - promise of an express response object
 */
async function handleAuthBearerToken(req, res, next) {
  const { oauthClient } = await getConfigurations();
  const redirectURLForAuthorizationCode = oauthClient.getAuthorizationUrl(req.path);
  const requestid = get(req, 'apiGateway.context.awsRequestId');
  // Parse the Authorization header
  const authHeader = req.headers.authorization;

  const match = authHeader.match(BEARER_TOKEN_REGEX);
  if (match) {
    const userToken = match[1];
    try {
      let username;
      if (process.env.OAUTH_PROVIDER === 'earthdata') {
        username = await oauthClient.getTokenUsername({
          onBehalfOf: 'OAuth-Client-Id',
          token: userToken,
        });
      }

      const params = {
        token: userToken,
        username,
        xRequestId: requestid,
      };
      const userInfo = await oauthClient.getUserInfo(removeNilProperties(params));
      req.authorizedMetadata = {
        userName: username || userInfo.username,
        userGroups: userInfo.user_groups || [],
      };
      return next();
    } catch (error) {
      log.error('handleAuthBearerToken', error);
      return res.redirect(307, redirectURLForAuthorizationCode);
    }
  }

  log.debug('Unable to get bearer token from authorization header');
  return res.redirect(307, redirectURLForAuthorizationCode);
}

/**
 * Ensure request is authorized through OAuth provider or redirect to become so.
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
        userGroups: get(accessTokenRecord, 'tokenInfo.user_groups', []),
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

module.exports = {
  buildLoginErrorTemplateVars,
  ensureAuthorizedOrRedirect,
  getConfigurations,
  handleAuthBearerToken,
  isAuthBearTokenRequest,
  useSecureCookies,
};
