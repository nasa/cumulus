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
function getDistributionAPIFileStream(fileUrl, accessToken) {
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

module.exports = {
  getDistributionAPIFileStream
};
