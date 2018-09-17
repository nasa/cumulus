'use strict';

const get = require('lodash.get');
const got = require('got');
const querystring = require('querystring');
const log = require('@cumulus/common/log');
const { aws } = require('@cumulus/common');
const { URL } = require('url');

/**
 * Extract the S3 bucket name and key from the URL path
 * parameters
 *
 * @param {string} pathParams - path parameters from the URL
 * @returns {Object} - bucket/key in the form of
 * { Bucket: x, Key: y }
 */
function getBucketAndKeyFromPathParams(pathParams) {
  const bucketEndIndex = pathParams.indexOf('/');
  return {
    Bucket: pathParams.substring(0, bucketEndIndex),
    Key: pathParams.substring(bucketEndIndex + 1)
  };
}

/**
 * Generate the parsed signed URL
 *
 * @param {Object} tokenInfo - response from Earthdata
 * @param {string} pathParams - path parameters from the URL
 * @param {string} sourceIp - source IP form event
 * @returns {string} - parsed, signed URL
 */
function generateParsedSignedUrl(tokenInfo, pathParams, sourceIp) {
  const user = tokenInfo.endpoint.replace('/api/users/', '');

  const objectParams = getBucketAndKeyFromPathParams(pathParams);

  // otherwise we get the temp url and provide it to the user
  const signedUrl = aws.s3().getSignedUrl('getObject', objectParams);

  // Add earthdataLoginUsername to signed url
  const parsedSignedUrl = new URL(signedUrl);
  const signedUrlParams = parsedSignedUrl.searchParams;
  signedUrlParams.set('x-EarthdataLoginUsername', user);
  parsedSignedUrl.search = signedUrlParams.toString();

  // now that we have the URL we have to save user's info
  log.info({
    userName: user,
    accessDate: Date.now(),
    file: objectParams.Key,
    bucket: objectParams.Bucket,
    sourceIp
  });

  return parsedSignedUrl;
}

/**
 * An AWS API Gateway function that either requests authentication,
 * or if authentication is found then redirects to an S3 file for download
 *
 * There are three main conditionals that control the UX flow,
 * following the patterns laid out in the EarthData Login OAuth specs:
 * https://urs.earthdata.nasa.gov/sso_client_impl
 *
 * 1. If the user does not have a token in their cookies, nor a
 * code in their querystring, then redirect them to the EarthData
 * Login page, where they enter their credentials and are redirected
 * with a code in their querystring
 *
 * 2. If the user has a code, then check that it is valid by making
 * a request to the EarthData servers. If the check is successful,
 * this will yield a username and token, which are stored in cookies
 *
 * 3. If the user has a username and auth token in their cookies,
 * then authorize them to access the requested file from the S3 bucket
 *
 * @param {Object} event - the AWS lambda event
 * @param {Object} context - thw AWS context
 * @param {function} cb - callback function
 * @returns {?} - return value of the callback function
 */
function handler(event, context, cb) {
  const EARTHDATA_CLIENT_ID = process.env.EARTHDATA_CLIENT_ID;
  const EARTHDATA_CLIENT_PASSWORD = process.env.EARTHDATA_CLIENT_PASSWORD;
  const DEPLOYMENT_ENDPOINT = process.env.DEPLOYMENT_ENDPOINT;

  const EARTHDATA_BASE_URL = process.env.EARTHDATA_BASE_URL || 'https://uat.urs.earthdata.nasa.gov/';
  const EARTHDATA_GET_CODE_URL = `${EARTHDATA_BASE_URL}oauth/authorize`;
  const EARTHDATA_CHECK_CODE_URL = `${EARTHDATA_BASE_URL}oauth/token`;

  let granuleKey = null;
  let query = {};

  if (event.pathParameters) {
    granuleKey = event.pathParameters.proxy;
  }

  if (event.queryStringParameters) {
    query = event.queryStringParameters;
    granuleKey = query.state;
  }

  // code means that this is a redirect back from
  // earthData login
  if (query.code) {
    // we send the code to another endpoint to verify
    return got.post(EARTHDATA_CHECK_CODE_URL, {
      json: true,
      form: true,
      body: {
        grant_type: 'authorization_code',
        code: query.code,
        redirect_uri: DEPLOYMENT_ENDPOINT
      },
      auth: `${EARTHDATA_CLIENT_ID}:${EARTHDATA_CLIENT_PASSWORD}`
    }).then((r) => {
      const tokenInfo = r.body;
      const accessToken = tokenInfo.access_token;

      // if no access token is given, then the code is wrong
      if (accessToken === undefined) {
        return cb(null, {
          statusCode: '400',
          body: '{"error": "Failed to get EarthData token"}'
        });
      }

      const parsedSignedUrl = generateParsedSignedUrl(
        tokenInfo,
        granuleKey,
        get(event, 'requestContext.identity.sourceIp', '0.0.0.0')
      );

      return cb(null, {
        statusCode: '302',
        body: 'redirecting',
        headers: {
          Location: parsedSignedUrl.toString(),
          'Strict-Transport-Security': 'max-age=31536000'
        }
      });
    }).catch(cb);
  }

  // ending up here means that user was not login
  // with earthdata and has to login
  const qs = {
    response_type: 'code',
    client_id: EARTHDATA_CLIENT_ID,
    redirect_uri: DEPLOYMENT_ENDPOINT,
    // For EarthData OAuth, we can use the `state` to remember which granule is being requested
    state: granuleKey
  };
  const response = {
    statusCode: '302',
    body: 'Redirect',
    headers: {
      Location: `${EARTHDATA_GET_CODE_URL}?${querystring.stringify(qs)}`,
      'Strict-Transport-Security': 'max-age=31536000'
    }
  };

  return cb(null, response);
}

module.exports = {
  handler,

  // for testing
  getBucketAndKeyFromPathParams,
  generateParsedSignedUrl
};
