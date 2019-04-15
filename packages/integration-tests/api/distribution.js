'use strict';

const { URL } = require('url');
const { Lambda } = require('aws-sdk');
const got = require('got');

/**
 * Invoke distribution api lambda directly to get a signed s3 URL.  This is
 * used in integration testing so that we use the lambda's IAM
 * role/permissions when accessing resources.
 *
 * @param {string} path
 *   path to file requested.  This is just "/bucket/keytofile"
 * @param {string} accessToken
 *   Access token from OAuth provider or nothing.
 * @returns {string}
 *   signed s3 URL for the requested file.
 */
async function invokeApiDistributionLambda(path, accessToken = '') {
  const lambda = new Lambda();
  const FunctionName = `${process.env.stackName}-ApiDistribution`;

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
 * Invoke the ApiDistributionLambda and return the headers location
 * @param {filepath} filepath - request.path parameter
 * @param {string} accessToken - authenticiation cookie (can be undefined).
 */
async function getDistributionApiRedirect(filepath, accessToken) {
  const payload = await invokeApiDistributionLambda(filepath, accessToken);
  return payload.headers.location;
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

module.exports = {
  getDistributionApiFileStream,
  getDistributionApiRedirect,
  getDistributionFileUrl,
  invokeApiDistributionLambda
};
