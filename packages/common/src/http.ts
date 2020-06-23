/**
 * A collection of functions to make working with http easier
 * @module
 */

import fs from 'fs';
import got from 'got';

/**
 * Download a file to disk
 *
 * @param {string} uri - the URI to request
 * @param {string} destination - Where to store file locally
 * @param {Object} options - additional download options
 * @param {Object} options.headers - headers to include in the request
 * @returns {Promise} - resolves when the download is complete
 */
export const download = (
  uri: string,
  destination: string,
  options?: got.GotOptions<string|null>
): Promise<undefined> => {
  const file = fs.createWriteStream(destination);

  return new Promise((resolve, reject) => {
    got.stream(uri, options)
      .on('error', reject)
      .pipe(file);

    file
      .on('finish', resolve)
      .on('error', reject);
  });
};
