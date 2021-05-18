'use strict';

const isEmpty = require('lodash/isEmpty');
const { resolve: pathresolve } = require('path');
const urljoin = require('url-join');
const { render } = require('nunjucks');

const { getFileBucketAndKey } = require('@cumulus/aws-client/S3');
const log = require('@cumulus/common/log');
// const { s3 } = require('@cumulus/aws-client/services');
const { RecordDoesNotExist, UnparsableFileLocationError } = require('@cumulus/errors');
const { URL } = require('url');

// const { EarthdataLoginClient } = require('@cumulus/earthdata-login-client');
// const { isLocalApi } = require('../lib/testUtils');
// const { AccessToken } = require('../models');
const { checkLoginQueryErrors, getConfigurations, getProfile, useSecureCookies } = require('../lib/distribution');

// Running API locally will be on http, not https, so cookies
// should not be set to secure for local runs of the API.
// const useSecureCookies = () => {
//   if (isLocalApi()) {
//     return false;
//   }
//   return true;
// };

/**
 * Return a signed URL to an S3 object
 *
 * @param {Object} s3Client - an AWS S3 Service Object
 * @param {string} Bucket - the bucket of the requested object
 * @param {string} Key - the key of the requested object
 * @param {string} username - the username to add to the redirect url
 * @returns {string} a URL
 */
function getSignedS3Url(s3Client, Bucket, Key, username) {
  const signedUrl = s3Client.getSignedUrl('getObject', { Bucket, Key });

  const parsedSignedUrl = new URL(signedUrl);
  parsedSignedUrl.searchParams.set('x-EarthdataLoginUsername', username);

  return parsedSignedUrl.toString();
}

/**
 * Returns a configuration object
 *
 * @returns {Object} the configuration object needed to handle requests
 */
// function getConfigurations() {
//   const earthdataLoginClient = new EarthdataLoginClient({
//     clientId: process.env.EARTHDATA_CLIENT_ID,
//     clientPassword: process.env.EARTHDATA_CLIENT_PASSWORD,
//     earthdataLoginUrl: process.env.EARTHDATA_BASE_URL || 'https://uat.urs.earthdata.nasa.gov/',
//     redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT,
//   });

//   return {
//     accessTokenModel: new AccessToken(),
//     authClient: earthdataLoginClient,
//     distributionUrl: process.env.DISTRIBUTION_ENDPOINT,
//     s3Client: s3(),
//   };
// }

/**
 * Sends a welcome page
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 */
async function handleRootRequest(req, res) {
  const {
    accessTokenModel,
    oauthClient,
    distributionUrl,
  } = await getConfigurations();
  const accessToken = req.cookies.accessToken;
  let accessTokenRecord;
  if (accessToken) {
    try {
      accessTokenRecord = await accessTokenModel.get({ accessToken });
    } catch (error) {
      if ((error instanceof RecordDoesNotExist) === false) {
        throw error;
      }
    }
  }

  const templateVars = {
    title: 'Welcome',
    profile: accessTokenRecord && accessTokenRecord.tokenInfo,
    logoutURL: urljoin(distributionUrl, 'logout'),
  };

  if (!accessToken || !accessTokenRecord) {
    const authorizeUrl = oauthClient.getAuthorizationUrl(req.path);
    templateVars.URL = authorizeUrl;
  }

  const rendered = render(pathresolve(__dirname, 'templates/root.html'), templateVars);
  return res.send(rendered);
}
/**
 * login endpoint
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} - promise of an express response object
 */
async function handleLoginRequest(req, res) {
  const {
    accessTokenModel,
    oauthClient,
    distributionUrl,
  } = await getConfigurations();

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
    const accessTokenResponse = await oauthClient.getAccessToken(code);
    log.debug('getAccessToken:', accessTokenResponse);

    const userProfile = await getProfile(oauthClient, accessTokenResponse);
    log.debug('Got the user profile: ', userProfile);

    // expirationTime is in seconds whereas Date is expecting milliseconds
    const expirationTime = accessTokenResponse.expirationTime * 1000;
    await accessTokenModel.create({
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
      .set({ Location: urljoin(distributionUrl, state || '') })
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
async function handleLogoutRequest(req, res) {
  const {
    oauthClient,
    distributionUrl,
  } = await getConfigurations();
  const accessToken = req.cookies.accessToken;
  const authorizeUrl = oauthClient.getAuthorizationUrl();
  res.clearCookie('accessToken',
    {
      httpOnly: true,
      secure: useSecureCookies(),
    });
  const templateVars = {
    title: 'Logged Out',
    contentstring: accessToken ? 'You are logged out.' : 'No active login found.',
    URL: authorizeUrl,
    logoutURL: urljoin(distributionUrl, 'logout'),
  };
  const rendered = render(pathresolve(__dirname, 'templates/root.html'), templateVars);
  return res.send(rendered);
}

/**
 * Responds to a redirect request
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function handleRedirectRequest(req, res) {
  const {
    accessTokenModel,
    oauthClient,
    distributionUrl,
  } = await getConfigurations();

  const { code, state } = req.query;

  const getAccessTokenResponse = await oauthClient.getAccessToken(code);

  await accessTokenModel.create({
    accessToken: getAccessTokenResponse.accessToken,
    expirationTime: getAccessTokenResponse.expirationTime,
    refreshToken: getAccessTokenResponse.refreshToken,
    username: getAccessTokenResponse.username,
  });

  return res
    .cookie(
      'accessToken',
      getAccessTokenResponse.accessToken,
      {
        // expirationTime is in seconds but Date() expects milliseconds
        expires: new Date(getAccessTokenResponse.expirationTime * 1000),
        httpOnly: true,
        secure: useSecureCookies(),
      }
    )
    .set({ Location: urljoin(distributionUrl, state) })
    .status(307)
    .send('Redirecting');
}

/**
 * Responds to a file request
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function handleFileRequest(req, res) {
  const { s3Client } = getConfigurations();

  let fileBucket;
  let fileKey;
  try {
    [fileBucket, fileKey] = getFileBucketAndKey(req.params[0]);
  } catch (error) {
    if (error instanceof UnparsableFileLocationError) {
      return res.boom.notFound(error.message);
    }
    throw error;
  }

  const signedS3Url = getSignedS3Url(
    s3Client,
    fileBucket,
    fileKey,
    req.authorizedMetadata.userName
  );

  return res
    .status(307)
    .set({ Location: signedS3Url })
    .send('Redirecting');
}

module.exports = {
  handleLoginRequest,
  handleLogoutRequest,
  handleRedirectRequest,
  handleRootRequest,
  handleFileRequest,
  useSecureCookies,
};
