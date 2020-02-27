'use strict';

const { URL } = require('url');
const { Lambda } = require('aws-sdk');
const got = require('got');
const jwt = require('jsonwebtoken');

const CloudFormation = require('@cumulus/aws-client/CloudFormation');
const SecretsManager = require('@cumulus/aws-client/SecretsManager');

const { getEarthdataAccessToken } = require('./EarthdataLogin');

/**
 * Invoke distribution API lambda directly to get a signed S3 URL.
 * This is used in integration testing so that we use the lambda's IAM
 * role/permissions when accessing resources.
 *
 * @param {string} path
 *   path to file requested.  This is just "/bucket/keytofile"
 * @param {headers} headers - Headers to use for TEA request
 * @returns {string}
 *   signed s3 URL for the requested file.
 */
async function invokeApiDistributionLambda(
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
 * Invoke the Distribution Lambda and return the headers location
 *
 * @param {filepath} filepath - request.path parameter
 * @param {Object} headers - Headers to use for Distribution API request
 * @returns {string} - Redirect header location
 */
async function getDistributionApiRedirect(filepath, headers) {
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
 * @param {string} accessToken
 *   Access token from OAuth provider
 *
 * @returns {ReadableStream}
 *   Stream to the file protected by the distribution
 */
async function getDistributionApiFileStream(filepath, accessToken) {
  const s3SignedUrl = await getDistributionApiRedirect(filepath, accessToken);
  return got.stream(s3SignedUrl);
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
 * Get headers to use for authenticating TEA requests.
 *
 * @param {string} stackName - Deployment name
 * @returns {Object} - Request headers
 */
async function getTEARequestHeaders(stackName) {
  const { JwtAlgo, JwtKeySecretName } = await CloudFormation.getCfStackParameterValues(
    `${stackName}-thin-egress-app`,
    ['JwtAlgo', 'JwtKeySecretName']
  );

  const {
    accessToken,
    expirationTime,
    username
  } = await getEarthdataAccessToken({
    redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT,
    requestOrigin: process.env.DISTRIBUTION_ENDPOINT,
    storeAccessToken: false
  });

  const jwtTEASecretValue = await SecretsManager.getSecretString(JwtKeySecretName)
    .then(JSON.parse);
  const jwtPrivateKey = Buffer.from(jwtTEASecretValue.rsa_priv_key, 'base64');
  const jwtToken = jwt.sign({
    'urs-user-id': username,
    'urs-access-token': accessToken,
    'urs-groups': [],
    exp: expirationTime
  }, jwtPrivateKey, {
    algorithm: JwtAlgo
  });

  // TODO: No great way to get cookie names dynamically?
  const cookieHeaders = [
    `urs-access-token=${accessToken}`,
    `asf-urs=${jwtToken}`
  ];

  const headers = { cookie: cookieHeaders.join(';') };

  return headers;
}

module.exports = {
  getDistributionApiFileStream,
  getDistributionApiRedirect,
  getDistributionFileUrl,
  getTEARequestHeaders,
  invokeApiDistributionLambda,
  invokeS3CredentialsLambda
};
