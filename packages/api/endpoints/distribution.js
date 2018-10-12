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

/**
 * Build an API Gateway redirect response
 *
 * @param {string} url - the URL to redirect to
 * @returns {Object} an API Gateway response object
 */
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

/**
 * Build an API Gateway client error response
 *
 * @param {string} errorMessage - the error message to be returned in the response
 * @returns {Object} an API Gateway response object
 */
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

/**
 * Return a signed URL to an S3 object
 *
 * @param {Object} s3Client - an AWS S3 Service Object
 * @param {string} Bucket - the bucket of the requested object
 * @param {string} Key - the key of the requested object
 * @param {string} username - the username to add to the redirect url
 * @returns {string} a URL
 */
function getSignedUrl(s3Client, Bucket, Key, username) {
  const signedUrl = s3Client.getSignedUrl('getObject', { Bucket, Key });

  const parsedSignedUrl = new URL(signedUrl);
  parsedSignedUrl.searchParams.set('x-EarthdataLoginUsername', username);

  return parsedSignedUrl.toString();
}

/**
 * Given a an API Gateway request, return either the proxy path parameter or
 *   the state query string parameter
 *
 * @param {Object} request - an API Gatway request object
 * @returns {string|undefined} a granule location
 */
function getGranuleLocationFromRequest(request) {
  return get(request, 'pathParameters.proxy')
    || get(request, 'queryStringParameters.state');
}

/**
 * Return the username associated with an OAuth2 authorization code
 *
 * @param {EarthdataLoginClient} earthdataLoginClient - an Earthdata Login Client
 * @param {string} authorizationCode - the OAuth2 authorization code to use
 * @returns {string} an Earthdata username
 */
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
