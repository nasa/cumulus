'use strict';

const got = require('got');

/**
 * Get S3 signed URL for file protected by distribution API
 *
 * @param {string} fileUrl
 *   Distribution API file URL to request
 * @param {string} accessToken
 *   Access token from OAuth provider
 *
 * @returns {Response} - response object from distribution api
 *   S3 signed URL to access file protected by distribution API
 */
async function getDistributionApiResponse(fileUrl, accessToken) {
  const response = await got(fileUrl, {
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
  getDistributionFileUrl
};
