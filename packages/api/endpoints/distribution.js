'use strict';

const get = require('lodash.get');
const log = require('@cumulus/common/log');
const { aws } = require('@cumulus/common');
const { URL } = require('url');

const EarthdataLoginClient = require('../lib/EarthdataLogin');
const {
  OAuth2AuthenticationFailure
} = require('../lib/OAuth2');

class UnparsableGranuleLocationError extends Error {
  constructor(granuleLocation) {
    super(`Granule location "${granuleLocation}" could not be parsed`);
    this.name = this.constructor.name;
  }
}

function buildRedirectResponse(url) {
  return {
    statusCode: 302,
    body: 'Redirect',
    headers: {
      Location: url,
      'Strict-Transport-Security': 'max-age=31536000'
    }
  };
}

function buildClientErrorResponse(errorMessage) {
  return {
    statusCode: 400,
    body: JSON.stringify({ error: errorMessage })
  };
}

/**
 * Extract the S3 bucket and key from the URL path parameters
 *
 * @param {string} pathParams - path parameters from the URL
 * @returns {Object} - bucket/key in the form of
 * { Bucket: x, Key: y }
 */
function getBucketAndKeyFromPathParams(pathParams) {
  const fields = pathParams.split('/');

  const Bucket = fields.shift();
  const Key = fields.join('/');

  if (Bucket.length === 0 || Key.length === 0) {
    throw new UnparsableGranuleLocationError(pathParams);
  }

  return { Bucket, Key };
}

function getSignedUrl(s3Client, Bucket, Key, username) {
  const signedUrl = s3Client.getSignedUrl('getObject', { Bucket, Key });

  const parsedSignedUrl = new URL(signedUrl);
  parsedSignedUrl.searchParams.set('x-EarthdataLoginUsername', username);

  return parsedSignedUrl.toString();
}

function getGranuleLocationFromRequest(request) {
  return get(request, 'pathParameters.proxy')
    || get(request, 'queryStringParameters.state');
}

async function getUsernameFromAuthorizationCode(earthdataLoginClient, authorizationCode) {
  const {
    username
  } = await earthdataLoginClient.getAccessToken(authorizationCode);

  return username;
}

/**
 * An AWS API Gateway function that either requests authentication,
 * or if authentication is found then redirects to an S3 file for download
 *
 * @param {Object} request - an API Gateway request object
 * @param {EarthdataLoginClient} earthdataLoginClient - an instance of an
 *   EarthdataLoginClient that will be used when authorizing this request
 * @param {AWS.S3} s3Client - an AWS S3 client that will be used when processing
 *   this request
 * @returns {Promise<Object>} an API Gateway response object
 */
async function handleRequest(request, earthdataLoginClient, s3Client) {
  const granuleLocation = getGranuleLocationFromRequest(request);

  const authorizationCode = get(request, 'queryStringParameters.code');

  if (authorizationCode) {
    try {
      const username = await getUsernameFromAuthorizationCode(
        earthdataLoginClient,
        authorizationCode
      );

      const {
        Bucket,
        Key
      } = getBucketAndKeyFromPathParams(granuleLocation);

      log.info({
        username,
        accessDate: Date.now(),
        bucket: Bucket,
        file: Key,
        sourceIp: get(request, 'requestContext.identity.sourceIp')
      });

      const s3RedirectUrl = getSignedUrl(
        s3Client,
        Bucket,
        Key,
        username
      );

      return buildRedirectResponse(s3RedirectUrl);
    }
    catch (err) {
      if (err instanceof OAuth2AuthenticationFailure) {
        return buildClientErrorResponse('Failed to get EarthData token');
      }

      if (err instanceof UnparsableGranuleLocationError) {
        return buildClientErrorResponse(err.message);
      }

      throw err;
    }
  }

  const authorizationUrl = earthdataLoginClient.getAuthorizationUrl(granuleLocation);

  return buildRedirectResponse(authorizationUrl);
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

  const s3Client = aws.s3();

  return handleRequest(event, earthdataLoginClient, s3Client);
}

module.exports = {
  handleRequest,
  handleApiGatewayRequest
};
