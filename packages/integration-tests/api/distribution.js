//@ts-check

'use strict';

const { URL } = require('url');
const { InvokeCommand } = require('@aws-sdk/client-lambda');
const { lambda } = require('@cumulus/aws-client/services');
const got = require('got');
const jwt = require('jsonwebtoken');

const CloudFormation = require('@cumulus/aws-client/CloudFormation');
const Logger = require('@cumulus/logger');
const { buildS3Uri } = require('@cumulus/aws-client/S3');
const SecretsManager = require('@cumulus/aws-client/SecretsManager');

const { getEarthdataAccessToken } = require('./EarthdataLogin');

const log = new Logger({ sender: '@cumulus/api/distribution' });

async function invokeDistributionApiLambda(path, headers) {
  const FunctionName = `${process.env.stackName}-DistributionApiEndpoints`;

  const event = {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    path,
    headers,
    // All of these properties are necessary for the distribution api request to succeed
    requestContext: {
      resourcePath: '/{proxy+}',
      operationName: 'proxy',
      httpMethod: 'GET',
      path: '/{proxy+}',
      identity: {
        sourceIp: '127.0.0.1',
      },
    },
    multiValueQueryStringParameters: null,
    pathParameters: {
      proxy: path.replace(/\/+/, ''),
    },
    body: null,
    stageVariables: null,
  };

  const data = await lambda().send(new InvokeCommand({
    FunctionName,
    Payload: new TextEncoder().encode(JSON.stringify(event)),
  }));

  const payload = JSON.parse(new TextDecoder('utf-8').decode(data.Payload));

  return payload;
}

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
        sourceIp: '127.0.0.1',
      },
    },
    multiValueQueryStringParameters: null,
    pathParameters: {
      proxy: path.replace(/\/+/, ''),
    },
    body: null,
    stageVariables: null,
  };

  const data = await lambda().send(new InvokeCommand({
    FunctionName,
    Payload: new TextEncoder().encode(JSON.stringify(event)),
  }));

  const payload = JSON.parse(new TextDecoder('utf-8').decode(data.Payload));

  return payload;
}

/**
 * Invoke s3-credentials-endpoint lambda directly to get s3 credentials.
 *
 * @param {string} path request path
 * @param {Object} headers request header
 * @returns {string} temporary credentials for s3 access
 */
async function invokeS3CredentialsLambda(path, headers) {
  const FunctionName = `${process.env.stackName}-s3-credentials-endpoint`;

  const event = {
    httpMethod: 'GET',
    path,
    headers,
  };

  const data = await lambda().send(new InvokeCommand({
    FunctionName,
    Payload: new TextEncoder().encode(JSON.stringify(event)),
  }));

  const payload = JSON.parse(new TextDecoder('utf-8').decode(data.Payload));

  return payload;
}

/**
 * Get URL to request file via distribution API
 *
 * @param {Object} params
 * @param {string} params.distributionEndpoint - Distribution API endpoint
 * @param {string} params.bucket - S3 bucket
 * @param {string} params.key - S3 object key
 * @param {string} params.urlType - url type, distribution or s3
 *
 * @returns {string} - Distribution API file URL
 */
function getDistributionFileUrl({
  distributionEndpoint = process.env.DISTRIBUTION_ENDPOINT,
  bucket,
  key,
  urlType = 'distribution',
}) {
  if (urlType === 's3') {
    return buildS3Uri(bucket, key);
  }
  return new URL(`${bucket}/${key}`, distributionEndpoint).href;
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
  const payload = await invokeTEADistributionLambda(
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
    expirationTime = Date.now(),
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
    exp: expirationTime,
  }, jwtPrivateKey, {
    algorithm: JwtAlgo,
    allowInsecureKeySizes: true,
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
    `asf-urs=${jwtToken}`,
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
    storeAccessToken: false,
  });

  const jwtToken = await getTEARequestJwtToken(stackName, accessTokenResponse);

  return buildTeaRequestHeaders(accessTokenResponse.accessToken, jwtToken);
}

async function getDistributionApiRedirect(filepath, headers) {
  const payload = await invokeDistributionApiLambda(
    filepath,
    headers
  );
  try {
    return payload.headers.location || payload.headers.Location;
  } catch (error) {
    log.error(error);
    log.debug(`No redirect location found in headers ${JSON.stringify(payload.headers)}`);
    log.debug(`full payload: ${JSON.stringify(payload)}`);
    throw error;
  }
}

module.exports = {
  getDistributionApiRedirect,
  getDistributionFileUrl,
  getTEADistributionApiFileStream,
  getTEADistributionApiRedirect,
  getTEARequestHeaders,
  invokeDistributionApiLambda,
  invokeS3CredentialsLambda,
};
