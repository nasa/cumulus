const isEmpty = require('lodash/isEmpty');
const urljoin = require('url-join');
const log = require('@cumulus/common/log');
const { getSecretString } = require('@cumulus/aws-client/SecretsManager');
const { EarthdataLoginClient } = require('@cumulus/earthdata-login-client');

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
    earthdataLoginUrl: process.env.OAUTH_HOST_URL,
    redirectUri: urljoin(process.env.API_BASE_URL, 'login'),
  };
  if (process.env.OAUTH_PROVIDER === 'earthdata') {
    return new EarthdataLoginClient(oauthClientConnfig);
  }
  // TODO update
  // return new CognitoClient(oauthClientConnfig);
  return new EarthdataLoginClient(oauthClientConnfig);
};

async function getAccessToken(code) {
  const oauthClient = await buildOAuthClient();
  return oauthClient.getAccessToken(code);
}

async function getProfile({ username, accessToken }) {
  //const oauthClient = await buildOAuthClient();
  if (username) { // EDL
    // // TODO add method not only get user profile
    // const uid = await oauthClient.getTokenUsername({
    //   onBehalfOf: username,
    //   token: accessToken,
    //   //xRequestId?: string where to get this
    // });
    // log.debug(uid);
  } else {
    // const uid = await oauthClient.getTokenUsername({
    //   onBehalfOf: username,
    //   token: accessToken,
    //   //xRequestId?: string where to get this
    // });
    // log.debug(uid);
    // if (userProfile.user_groups === undefined) {
    //   userProfile.user_groups = [];
    // }
  }
  // TODO handle any errors and rename the one from EDL
  return {
    username: 'Jane Doe',
    given_name: 'Jane',
    family_name: 'Doe',
    study_area: 'Atmospheric Composition',
    organization: 'NASA',
    email: 'janedoe@example.com',
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
  buildOAuthClient,
  getAccessToken,
  getProfile,
};
