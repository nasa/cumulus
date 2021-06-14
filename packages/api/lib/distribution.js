const get = require('lodash/get');
const isEmpty = require('lodash/isEmpty');
const log = require('@cumulus/common/log');
const { removeNilProperties } = require('@cumulus/common/util');
const { getSecretString } = require('@cumulus/aws-client/SecretsManager');
const { CognitoClient, EarthdataLoginClient } = require('@cumulus/oauth-client');
const { s3 } = require('@cumulus/aws-client/services');

const { isLocalApi } = require('./testUtils');
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
 * @returns {Object} - OAuthClient object
 */
const buildOAuthClient = async () => {
  if (process.env.OAUTH_CLIENT_PASSWORD === undefined) {
    const clientPassword = await getSecretString(process.env.OAUTH_CLIENT_PASSWORD_SECRETE_NAME);
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
 * @returns {boolean} - whether this request goes to a public bucket
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

function isAuthBearTokenRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const match = authHeader.match(BEARER_TOKEN_REGEX);
    if (match.length >= 2) return true;
  }
  return false;
}

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
        ...{ userGroups: userInfo.user_groups },
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

module.exports = {
  buildLoginErrorTemplateVars,
  getConfigurations,
  handleAuthBearerToken,
  isAuthBearTokenRequest,
  isPublicData,
  useSecureCookies,
};
