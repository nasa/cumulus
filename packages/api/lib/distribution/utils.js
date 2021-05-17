const isEmpty = require('lodash/isEmpty');
const urljoin = require('url-join');
const log = require('@cumulus/common/log');
const { getSecretString } = require('@cumulus/aws-client/SecretsManager');
const { EarthdataLoginClient } = require('@cumulus/earthdata-login-client');

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
  try {
    const auth = await oauthClient.getAccessToken(code);
    return auth;
  } catch (error) {
    log.error('Error fetching auth', error);
    return {};
  }
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

function checkLoginQuery(query) {
  let statusCode = 200;
  let templateVars = {};
  if (isEmpty(query)) {
    templateVars = {
      contentstring: 'No params',
      title: 'Could Not Login',
      statusCode: 400,
    };
    statusCode = 400;
  } else if (query.error) {
    templateVars = {
      contentstring: `An error occurred while trying to log. OAuth provider says: "${query.error}".`,
      title: 'Could Not Login',
      statusCode: 400,
    };
    statusCode = 400;
  } else if (query.code === undefined) {
    statusCode = 400;
    templateVars = {
      contentstring: 'Did not get the required CODE from OAuth provider',
      title: 'Could not login.',
      statusCode: 400,
    };
  }
  return { statusCode, templateVars };
}

module.exports = {
  checkLoginQuery,
  buildOAuthClient,
  getAccessToken,
  getProfile,
};
