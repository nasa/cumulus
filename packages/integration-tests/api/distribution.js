'use strict';

const got = require('got');

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
function getDistributionApiFileStream(fileUrl, accessToken) {
  return got
    .stream(fileUrl, {
      headers: {
        cookie: [`accessToken=${accessToken}`]
      }
    })
    .on('redirect', (_, nextOptions) => {
      // See https://github.com/sindresorhus/got/issues/719
      // eslint-disable-next-line no-param-reassign
      nextOptions.port = null;
    });
}

/**
 * Get URL to request file via distribution API
 *
 * @param {Object} params
 * @param {string} params.bucket - S3 bucket
 * @param {string} params.key - S3 object key
 *
 * @returns {string} - Distribution API file URL
 */
function getDistributionFileUrl({ bucket, key }) {
  return `${process.env.DISTRIBUTION_ENDPOINT}/${bucket}/${key}`;
}

module.exports = {
  getDistributionApiFileStream,
  getDistributionFileUrl
};
