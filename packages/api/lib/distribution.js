const isEmpty = require('lodash/isEmpty');
const { getSecretString } = require('@cumulus/aws-client/SecretsManager');
const { CognitoClient, EarthdataLoginClient } = require('@cumulus/oauth-client');
const { s3 } = require('@cumulus/aws-client/services');

const { isLocalApi } = require('./testUtils');
const { AccessToken } = require('../models');

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
  const oauthClientConnfig = {
    clientId: process.env.OAUTH_CLIENT_ID,
    clientPassword: process.env.OAUTH_CLIENT_PASSWORD,
    loginUrl: process.env.OAUTH_HOST_URL,
    redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT,
  };
  if (process.env.OAUTH_PROVIDER === 'earthdata') {
    return new EarthdataLoginClient(oauthClientConnfig);
  }
  return new CognitoClient(oauthClientConnfig);
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
function checkLoginQueryErrors(query) {
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

module.exports = {
  checkLoginQueryErrors,
  getConfigurations,
  useSecureCookies,
};
