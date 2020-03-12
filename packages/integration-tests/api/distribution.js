'use strict';

const { URL } = require('url');
const { Lambda } = require('aws-sdk');
const got = require('got');
const jwt = require('jsonwebtoken');

const CloudFormation = require('@cumulus/aws-client/CloudFormation');
const SecretsManager = require('@cumulus/aws-client/SecretsManager');
const { deprecate } = require('@cumulus/common/util');

const { getEarthdataAccessToken } = require('./EarthdataLogin');

/**
 * Invoke Thin Egress App API lambda directly to get a response payload.
 *
 * This is used in integration testing so that we use the lambda's IAM
 * role/permissions when accessing resources.
 *
 * @param {string} path
 *   path to file requested.  This is just "/bucket/keytofile"
 * @param {headers} headers
 *   Headers to use for TEA request
 *   @see getTEARequestHeaders()
 * @returns {string}
 *   signed s3 URL for the requested file.
 */
async function invokeTEADistributionLambda(
  path,
  headers
) {
  const lambda = new Lambda();
  const FunctionName = `${process.env.stackName}-thin-egress-app-EgressLambda`;

  const event = {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    path,
    headers,
    // All of these properties are necessary for the TEA request to succeed
    requestContext: {
      resourcePath: '/{proxy+}',
      operationName: 'proxy',
      httpMethod: 'GET',
      path: '/{proxy+}',
      identity: {
        sourceIp: '127.0.0.1'
      }
    },
    multiValueQueryStringParameters: null,
    pathParameters: {
      proxy: path.replace(/\/+/, '')
    },
    body: null,
    stageVariables: null
  };

  const data = await lambda.invoke({
    FunctionName,
    Payload: JSON.stringify(event)
  }).promise();

  const payload = JSON.parse(data.Payload);

  return payload;
}

/**
 * Maintained for legacy compatibility.
 *
 * @param {string} path
 *   path to file requested.  This is just "/bucket/keytofile"
 * @param {headers} headers
 *   Headers to use for TEA request
 *   @see getTEARequestHeaders()
 * @returns {string}
 *   signed s3 URL for the requested file.
 */
function invokeApiDistributionLambda(path, headers) {
  deprecate(
    '@cumulus/integration-tests/api/distribution.invokeApiDistributionLambda',
    '1.19.0',
    '@cumulus/integration-tests/api/distribution.invokeTEADistributionLambda'
  );
  return invokeTEADistributionLambda(path, headers);
}

/**
 * Invoke s3-credentials-endpoint lambda directly to get s3 credentials. This
 * is used in integration testing so that we use the lambda's IAM
 * role/permissions when accessing resources.
 *
 * @param {string} path
 *   path to file requested.  This is just "/bucket/keytofile"
 * @param {string} accessToken
 *   Access token from OAuth provider or nothing.
 * @returns {string}
 *   signed s3 URL for the requested file.
 */
async function invokeS3CredentialsLambda(path, accessToken = '') {
  const lambda = new Lambda();
  const FunctionName = `${process.env.stackName}-s3-credentials-endpoint`;

  const event = {
    method: 'GET',
    path
  };

  if (accessToken) {
    event.headers = { cookie: [`accessToken=${accessToken}`] };
  }

  const data = await lambda.invoke({
    FunctionName,
    Payload: JSON.stringify(event)
  }).promise();

  const payload = JSON.parse(data.Payload);

  return payload;
}

/**
 * Get URL to request file via distribution API
 *
 * @param {Object} params
 * @param {string} params.distributionEndpoint - Distribution API endpoint
 * @param {string} params.bucket - S3 bucket
 * @param {string} params.key - S3 object key
 *
 * @returns {string} - Distribution API file URL
 */
function getDistributionFileUrl({
  distributionEndpoint = process.env.DISTRIBUTION_ENDPOINT,
  bucket,
  key
}) {
  const theUrl = new URL(`${bucket}/${key}`, distributionEndpoint);
  return theUrl.href;
}

/**
 * Invoke the Distribution Lambda and return the headers location
 *
 * @param {filepath} filepath - request.path parameter
 * @param {Object} headers
 *   Headers to use for TEA API request
 *   @see getTEARequestHeaders()
 * @returns {string} - Redirect header location
 */
async function getTEADistributionApiRedirect(filepath, headers) {
  const payload = await invokeApiDistributionLambda(
    filepath,
    headers
  );
  return payload.headers.Location;
}

/**
 * Return a stream for file protected by distribution API by invoking the
 * lambda directly and reading the returned signed url.
 *
 * @param {string} filepath
 *   Distribution API file path to request
 * @param {Object} headers
 *   Headers to use for TEA API request
 *   @see getTEARequestHeaders()
 *
 * @returns {ReadableStream}
 *   Stream to the file protected by the distribution
 */
async function getTEADistributionApiFileStream(filepath, headers) {
  const s3SignedUrl = await getTEADistributionApiRedirect(filepath, headers);
  return got.stream(s3SignedUrl);
}

/**
 * Get JWT for TEA request header.
 *
 * @param {string} stackName - Deployment name
 * @param {Object} params
 * @param {string} params.accessToken - Access token from Oauth response
 * @param {string} params.username - Username for access token
 * @param {integer} params.expirationTime - Expiration time for the access token
 * @returns {string} - A JWT for the TEA request
 */
async function getTEARequestJwtToken(
  stackName,
  {
    accessToken,
    username = '',
    expirationTime = Date.now()
  }
) {
  const { JwtAlgo, JwtKeySecretName } = await CloudFormation.getCfStackParameterValues(
    `${stackName}-thin-egress-app`,
    ['JwtAlgo', 'JwtKeySecretName']
  );

  const jwtTEASecretValue = await SecretsManager.getSecretString(JwtKeySecretName)
    .then(JSON.parse);
  const jwtPrivateKey = Buffer.from(jwtTEASecretValue.rsa_priv_key, 'base64');
  return jwt.sign({
    'urs-user-id': username,
    'urs-access-token': accessToken,
    'urs-groups': [],
    exp: expirationTime
  }, jwtPrivateKey, {
    algorithm: JwtAlgo
  });
}

/**
 * Build the headers object for a TEA request.
 *
 * @param {string} accessToken - Access token from an Oauth response
 * @param {string} jwtToken
 *   JWT for TEA request
 *   @see getTEARequestJwtToken()
 * @returns {Object} - Request headers
 */
function buildTeaRequestHeaders(accessToken, jwtToken) {
  // TODO: No great way to get cookie names dynamically?
  const cookieHeaders = [
    `urs-access-token=${accessToken}`,
    `asf-urs=${jwtToken}`
  ];

  return { cookie: cookieHeaders.join(';') };
}

/**
 * Get headers to use for authenticating TEA requests.
 *
 * @param {string} stackName - Deployment name
 * @returns {Object} - Request headers
 */
async function getTEARequestHeaders(stackName) {
  const accessTokenResponse = await getEarthdataAccessToken({
    redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT,
    requestOrigin: process.env.DISTRIBUTION_ENDPOINT,
    storeAccessToken: false
  });

  const jwtToken = await getTEARequestJwtToken(stackName, accessTokenResponse);

  return buildTeaRequestHeaders(accessTokenResponse.accessToken, jwtToken);
}

/**
 * Invoke the Distribution Lambda and return the headers location
 *
 * @param {filepath} filepath - request.path parameter
 * @param {Object} headers
 *   Headers to use for Distribution API request
 *   @see getTEARequestHeaders()
 * @returns {string} - Redirect header location
 */
function getDistributionApiRedirect(filepath, headers) {
  deprecate(
    '@cumulus/integration-tests/api/distribution.getDistributionApiRedirect',
    '1.19.0',
    '@cumulus/integration-tests/api/distribution.getTEADistributionApiRedirect'
  );
  return getTEADistributionApiRedirect(filepath, headers);
}

/**
 * Return a stream for file protected by distribution API by invoking the
 * lambda directly and reading the returned signed url.
 *
 * @param {string} filepath
 *   Distribution API file path to request
 * @param {string} accessToken
 *   Access token from OAuth provider
 *
 * @returns {ReadableStream}
 *   Stream to the file protected by the distribution
 */
async function getDistributionApiFileStream(filepath, accessToken) {
  deprecate(
    '@cumulus/integration-tests/api/distribution.getDistributionApiFileStream',
    '1.19.0',
    '@cumulus/integration-tests/api/distribution.getTEADistributionApiFileStream'
  );
  const teaJwtToken = await getTEARequestJwtToken(
    process.env.DEPLOYMENT,
    {
      accessToken,
      expirationTime: Date.now()
    }
  );
  const headers = buildTeaRequestHeaders(accessToken, teaJwtToken);
  const s3SignedUrl = await getTEADistributionApiRedirect(filepath, headers);
  return got.stream(s3SignedUrl);
}

module.exports = {
  getDistributionApiFileStream,
  getDistributionApiRedirect,
  getDistributionFileUrl,
  getTEADistributionApiFileStream,
  getTEADistributionApiRedirect,
  getTEARequestHeaders,
  invokeApiDistributionLambda,
  invokeS3CredentialsLambda
};
