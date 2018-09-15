/**
 * A collection of functions to make working with http easier
 * @module
 */

'use strict';

const fs = require('fs');
const got = require('got');

/**
 * Download a file to disk
 *
 * @param {string} uri - the URI to request
 * @param {string} destination - Where to store file locally
 * @param {Object} options - additional download options
 * @param {Object} options.headers - headers to include in the request
 * @returns {Promise} - resolves when the download is complete
 */
exports.download = (uri, destination, options = {}) => {
  const file = fs.createWriteStream(destination);

  return new Promise((resolve, reject) => {
    got.stream(uri, { headers: options.headers })
      .on('error', reject)
      .pipe(file);

    file
      .on('finish', resolve)
      .on('error', reject);
  });
};
