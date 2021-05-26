'use strict';

const get = require('lodash/get');
const isEmpty = require('lodash/isEmpty');
const { render } = require('nunjucks');
const { resolve: pathresolve } = require('path');
const urljoin = require('url-join');
const { URL } = require('url');
const { getFileBucketAndKey } = require('@cumulus/aws-client/S3');
const log = require('@cumulus/common/log');
const { removeNilProperties } = require('@cumulus/common/util');
const { RecordDoesNotExist, UnparsableFileLocationError } = require('@cumulus/errors');
const { inTestMode } = require('@cumulus/common/test-utils');
const { checkLoginQueryErrors, getConfigurations, useSecureCookies } = require('../lib/distribution');

const templatesDirectory = (inTestMode())
  ? pathresolve(__dirname, '../app/data/distribution/templates')
  : pathresolve(__dirname, 'templates');

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
  parsedSignedUrl.searchParams.set('A-userid', username);

  return parsedSignedUrl.toString();
}

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

  // req.apiGateway is not available for unit test
  const requestid = get(req, 'apiGateway.context.awsRequestId');
  const templateVars = {
    title: 'Welcome',
    profile: accessTokenRecord && accessTokenRecord.tokenInfo,
    logoutURL: urljoin(distributionUrl, 'logout'),
    requestid,
  };

  if (!accessToken || !accessTokenRecord) {
    const authorizeUrl = oauthClient.getAuthorizationUrl(req.path);
    templateVars.URL = authorizeUrl;
  }

  const rendered = render(pathresolve(templatesDirectory, 'root.html'), templateVars);
  return res.send(rendered);
}

/**
 * Responds to a login/redirect request
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
  const errorTemplate = pathresolve(templatesDirectory, 'error.html');
  const requestid = get(req, 'apiGateway.context.awsRequestId');
  log.debug('the query params:', req.query);
  const templateVars = checkLoginQueryErrors(req.query);
  if (!isEmpty(templateVars) && templateVars.statusCode >= 400) {
    templateVars.requestid = requestid;
    const rendered = render(errorTemplate, templateVars);
    return res.status(templateVars.statusCode).send(rendered);
  }

  try {
    log.debug('pre getAccessToken() with query params:', req.query);
    const accessTokenResponse = await oauthClient.getAccessToken(code);
    log.debug('getAccessToken:', accessTokenResponse);

    // getAccessToken returns username only for EDL
    const params = {
      token: accessTokenResponse.accessToken,
      username: accessTokenResponse.username,
      xRequestId: requestid,
    };
    const userInfo = await oauthClient.getUserInfo(removeNilProperties(params));
    log.debug('getUserInfo:', userInfo);

    await accessTokenModel.create({
      accessToken: accessTokenResponse.accessToken,
      expirationTime: accessTokenResponse.expirationTime,
      refreshToken: accessTokenResponse.refreshToken,
      username: accessTokenResponse.username || userInfo.username,
      tokenInfo: userInfo,
    });

    return res
      .cookie(
        'accessToken',
        accessTokenResponse.accessToken,
        {
          // expirationTime is in seconds but Date() expects milliseconds
          expires: new Date(accessTokenResponse.expirationTime * 1000),
          httpOnly: true,
          secure: useSecureCookies(),
        }
      )
      .status(301)
      .set({ Location: urljoin(distributionUrl, state || '') })
      .send('Redirecting');
  } catch (error) {
    log.error('Error occurred while trying to login:', error);
    const vars = {
      contentstring: `There was a problem talking to OAuth provider, ${error.message}`,
      title: 'Could Not Login',
      statusCode: 401,
      requestid,
    };
    const rendered = render(errorTemplate, vars);
    return res.status(401).send(rendered);
  }
}

/**
 * Responds to a logout request
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} - promise of an express response object
 */
async function handleLogoutRequest(req, res) {
  const {
    accessTokenModel,
    oauthClient,
    distributionUrl,
  } = await getConfigurations();
  const accessToken = req.cookies.accessToken;
  const authorizeUrl = oauthClient.getAuthorizationUrl();
  const requestid = get(req, 'apiGateway.context.awsRequestId');
  await accessTokenModel.delete({ accessToken });
  const templateVars = {
    title: 'Logged Out',
    contentstring: accessToken ? 'You are logged out.' : 'No active login found.',
    URL: authorizeUrl,
    logoutURL: urljoin(distributionUrl, 'logout'),
    requestid,
  };

  const rendered = render(pathresolve(templatesDirectory, 'root.html'), templateVars);
  return res.send(rendered);
}

/**
 * Responds to a file request
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */

async function handleFileRequest(req, res) {
  const { s3Client } = await getConfigurations();
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
  handleRootRequest,
  handleFileRequest,
  useSecureCookies,
};
