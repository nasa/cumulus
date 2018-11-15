'use strict';

const urljoin = require('url-join');
const { aws } = require('@cumulus/common');
const { URL } = require('url');
const { Cookie } = require('tough-cookie');

const EarthdataLoginClient = require('../lib/EarthdataLogin');

const { getCookie } = require('../lib/api-gateway');
const { RecordDoesNotExist } = require('../lib/errors');
const { AccessToken } = require('../models');
const {
  NotFoundResponse,
  TemporaryRedirectResponse
} = require('../lib/responses');

class UnparsableFileLocationError extends Error {
  constructor(fileLocation) {
    super(`File location "${fileLocation}" could not be parsed`);
    this.name = this.constructor.name;
  }
}

/**
 * Extract the S3 bucket and key from the URL path parameters
 *
 * @param {string} pathParams - path parameters from the URL
 * @returns {Object} - bucket/key in the form of
 * { Bucket: x, Key: y }
 */
function getFileBucketAndKey(pathParams) {
  const fields = pathParams.split('/');

  const Bucket = fields.shift();
  const Key = fields.join('/');

  if (Bucket.length === 0 || Key.length === 0) {
    throw new UnparsableFileLocationError(pathParams);
  }

  return [Bucket, Key];
}

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

function getAccessTokenFromRequest(request) {
  const accessTokenCookie = getCookie(request, 'accessToken');

  return accessTokenCookie ? accessTokenCookie.value : null;
}

function isRedirectRequest(request) {
  return request.resource === '/redirect';
}

function isAccessTokenExpired(accessTokenRecord) {
  return accessTokenRecord.expirationTime < Date.now();
}

async function handleRedirectRequest(params = {}) {
  const {
    accessTokenModel,
    authClient,
    distributionUrl,
    request
  } = params;

  const { code, state } = request.queryStringParameters;

  const getAccessTokenResponse = await authClient.getAccessToken(code);

  await accessTokenModel.create({
    accessToken: getAccessTokenResponse.accessToken,
    expirationTime: getAccessTokenResponse.expirationTime,
    refreshToken: getAccessTokenResponse.refreshToken,
    username: getAccessTokenResponse.username
  });

  return new TemporaryRedirectResponse({
    location: urljoin(distributionUrl, state),
    cookies: [
      new Cookie({
        key: 'accessToken',
        value: getAccessTokenResponse.accessToken,
        expires: new Date(getAccessTokenResponse.expirationTime),
        httpOnly: true,
        secure: true
      })
    ]
  });
}

async function handleFileRequest(params = {}) {
  const {
    accessTokenModel,
    authClient,
    request,
    s3Client
  } = params;

  const redirectToGetAuthorizationCode = new TemporaryRedirectResponse({
    location: authClient.getAuthorizationUrl(request.pathParameters.proxy)
  });

  const accessToken = getAccessTokenFromRequest(request);

  if (!accessToken) return redirectToGetAuthorizationCode;

  let accessTokenRecord;
  try {
    accessTokenRecord = await accessTokenModel.get({ accessToken });
  }
  catch (err) {
    if (err instanceof RecordDoesNotExist) {
      return redirectToGetAuthorizationCode;
    }

    throw err;
  }

  if (isAccessTokenExpired(accessTokenRecord)) {
    return redirectToGetAuthorizationCode;
  }

  let fileBucket;
  let fileKey;
  try {
    [fileBucket, fileKey] = getFileBucketAndKey(request.pathParameters.proxy);
  }
  catch (err) {
    if (err instanceof UnparsableFileLocationError) return new NotFoundResponse();
    throw err;
  }

  const signedS3Url = getSignedS3Url(
    s3Client,
    fileBucket,
    fileKey,
    accessTokenRecord.username
  );

  return new TemporaryRedirectResponse({ location: signedS3Url });
}

async function handleRequest(params = {}) {
  const {
    accessTokenModel,
    authClient,
    distributionUrl,
    request,
    s3Client
  } = params;

  if (isRedirectRequest(request)) {
    return handleRedirectRequest({
      accessTokenModel,
      authClient,
      distributionUrl,
      request
    });
  }

  return handleFileRequest({
    accessTokenModel,
    authClient,
    request,
    s3Client
  });
}

/**
 * Handle a request from API Gateway
 *
 * @param {Object} event - an API Gateway request
 * @returns {Promise<Object>} - an API Gateway response
 */
async function handleApiGatewayRequest(event) {
  const earthdataLoginClient = new EarthdataLoginClient({
    clientId: process.env.EARTHDATA_CLIENT_ID,
    clientPassword: process.env.EARTHDATA_CLIENT_PASSWORD,
    earthdataLoginUrl: process.env.EARTHDATA_BASE_URL || 'https://uat.urs.earthdata.nasa.gov/',
    redirectUri: process.env.DEPLOYMENT_ENDPOINT
  });

  return handleRequest({
    accessTokenModel: new AccessToken(),
    authClient: earthdataLoginClient,
    distributionUrl: process.env.DISTRIBUTION_URL,
    request: event,
    s3Client: aws.s3()
  });
}

module.exports = {
  handleRequest,
  handleApiGatewayRequest
};
