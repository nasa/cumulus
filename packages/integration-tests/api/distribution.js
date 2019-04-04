'use strict';

const { Lambda } = require('aws-sdk');
const { URL } = require('url');
const got = require('got');

/**
 * Get S3 signed URL for file protected by distribution API
 *
 * @param {string} fileUrl
 *   Distribution API file URL to request
 * @param {string} accessToken
 *   Access token from OAuth provider
 *
 * @returns {Promise.<Response>} - Promise of response object from distribution
 *   api S3 signed URL to access file protected by distribution API
 */
async function getDistributionApiResponse(fileUrl, accessToken) {
  const response = got(fileUrl, {
    followRedirect: false,
    headers: {
      cookie: [`accessToken=${accessToken}`]
    }
  });
  return response;
}

/**
 * Get S3 signed URL for file protected by distribution API
 *
 * @param {string} fileUrl
 *   Distribution API file URL to request
 * @param {string} accessToken
 *   Access token from OAuth provider
 *
 * @returns {string}
 *   S3 signed URL to access file protected by distribution API
 */
async function getDistributionApiS3SignedUrl(fileUrl, accessToken) {
  const response = await getDistributionApiResponse(fileUrl, accessToken);
  return response.headers.location;
}

/**
 * Return a stream for file protected by distribution API
 *
 * @param {string} fileUrl
 *   Distribution API file URL to request
 * @param {string} accessToken
 *   Access token from OAuth provider
 *
 * @returns {ReadableStream}
 *   Stream to the file protected by the distribution
 */
async function getDistributionApiFileStream(fileUrl, accessToken) {
  const s3SignedUrl = await getDistributionApiS3SignedUrl(fileUrl, accessToken);
  return got.stream(s3SignedUrl);
}


/**
 * Invoke distribution api lambda directly to get a signed s3 URL.  This is
 * used in integration testing so that we use the lambda's IAM
 * role/permissions when accessing resources.
 *
 * @param {string} fileUrl
 *   Distribution API file URL to request
 * @param {string} accessToken
 *   Access token from OAuth provider
 * @returns {string}
 *   signed s3 URL for the requested file.
 */
async function invokeLambdaForS3SignedUrl(fileUrl, accessToken) {
  const lambda = new Lambda();
  const FunctionName = `${process.env.stackName}-ApiDistribution`;

  const path = fileUrl.replace(process.env.DISTRIBUTION_ENDPOINT, '/').replace('//', '/');
  const event = {
    method: 'GET',
    path,
    headers: {
      cookie: [`accessToken=${accessToken}`]
    }
  };
  const data = await lambda.invoke({
    FunctionName,
    Payload: JSON.stringify(event)
  }).promise();

  const payload = JSON.parse(data.Payload);

  return payload.headers.location;
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
  return `${distributionEndpoint}/${bucket}/${key}`;
}

module.exports = {
  getDistributionApiResponse,
  getDistributionApiS3SignedUrl,
  getDistributionApiFileStream,
  getDistributionFileUrl,
  invokeLambdaForS3SignedUrl
};
