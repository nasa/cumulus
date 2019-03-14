'use strict';

const router = require('express-promise-router')();
const urljoin = require('url-join');
const {
  s3,
  getFileBucketAndKey
} = require('@cumulus/common/aws');
const { UnparsableFileLocationError } = require('@cumulus/common/errors');
const { URL } = require('url');
const EarthdataLogin = require('../lib/EarthdataLogin');
const { RecordDoesNotExist } = require('../lib/errors');
const { AccessToken } = require('../models');
const s3credentials = require('./s3credentials');

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
 * Checks if the token is expired
 *
 * @param {Object} accessTokenRecord - the access token record
 * @returns {boolean} true indicates the token is expired
 */
function isAccessTokenExpired(accessTokenRecord) {
  return accessTokenRecord.expirationTime < Date.now();
}

/**
 * Returns a configuration object
 *
 * @returns {Object} the configuration object needed to handle requests
 */
function getConfigurations() {
  const earthdataLoginClient = EarthdataLogin.createFromEnv({
    redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT
  });

  return {
    accessTokenModel: new AccessToken(),
    authClient: earthdataLoginClient,
    distributionUrl: process.env.DISTRIBUTION_ENDPOINT,
    s3Client: s3()
  };
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
    authClient,
    distributionUrl
  } = getConfigurations();

  const { code, state } = req.query;

  const getAccessTokenResponse = await authClient.getAccessToken(code);

  await accessTokenModel.create({
    accessToken: getAccessTokenResponse.accessToken,
    expirationTime: getAccessTokenResponse.expirationTime,
    refreshToken: getAccessTokenResponse.refreshToken,
    username: getAccessTokenResponse.username
  });

  return res
    .cookie(
      'accessToken',
      getAccessTokenResponse.accessToken,
      {
        expires: new Date(getAccessTokenResponse.expirationTime),
        httpOnly: true,
        secure: true
      }
    )
    .set({ Location: urljoin(distributionUrl, state) })
    .status(307)
    .send('Redirecting');
}

async function handleCredentialRequest(req, res) {
  const {
    accessTokenModel,
    authClient,
  } = getConfigurations();

  const redirectToGetAuthorizationCode = res
    .status(307)
    .set({ Location: authClient.getAuthorizationUrl('/s3credentials') });

  const accessToken = req.cookies.accessToken;

  if (!accessToken) return redirectToGetAuthorizationCode.send('Redirecting');

  let accessTokenRecord;
  try {
    accessTokenRecord = await accessTokenModel.get({ accessToken });
  }
  catch (err) {
    if (err instanceof RecordDoesNotExist) {
      return redirectToGetAuthorizationCode.send('Redirecting');
    }

    throw err;
  }

  if (isAccessTokenExpired(accessTokenRecord)) {
    return redirectToGetAuthorizationCode.send('Redirecting');
  }
  req.authorizedMetadata = {userName: accessTokenRecord.username};
  res.status(200);
  return s3credentials(req, res);
}

/**
 * Responds to a file request
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function handleFileRequest(req, res) {
  const {
    accessTokenModel,
    authClient,
    s3Client
  } = getConfigurations();

  const redirectToGetAuthorizationCode = res
    .status(307)
    .set({ Location: authClient.getAuthorizationUrl(req.params[0]) });

  const accessToken = req.cookies.accessToken;

  if (!accessToken) return redirectToGetAuthorizationCode.send('Redirecting');

  let accessTokenRecord;
  try {
    accessTokenRecord = await accessTokenModel.get({ accessToken });
  }
  catch (err) {
    if (err instanceof RecordDoesNotExist) {
      return redirectToGetAuthorizationCode.send('Redirecting');
    }

    throw err;
  }

  if (isAccessTokenExpired(accessTokenRecord)) {
    return redirectToGetAuthorizationCode.send('Redirecting');
  }

  let fileBucket;
  let fileKey;
  try {
    [fileBucket, fileKey] = getFileBucketAndKey(req.params[0]);
  }
  catch (err) {
    if (err instanceof UnparsableFileLocationError) {
      return res.boom.notFound(err.message);
    }
    throw err;
  }

  const signedS3Url = getSignedS3Url(
    s3Client,
    fileBucket,
    fileKey,
    accessTokenRecord.username
  );

  return res
    .status(307)
    .set({ Location: signedS3Url })
    .send('Redirecting');
}

router.get('/redirect', handleRedirectRequest);
router.get('/s3credentials', handleCredentialRequest);
router.get('/*', handleFileRequest);

module.exports = router;
