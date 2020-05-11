'use strict';

const got = require('got');

/**
 * Get the CMR JSON metadata from the cmrLink
 *
 * @param {string} conceptLink - link to concept in CMR
 * @param {Object} headers - the CMR headers
 * @returns {Object} - metadata as a JS object, null if not
 * found
 */
async function getConceptMetadata(conceptLink, headers) {
  const response = await got.get(conceptLink, { headers });

  if (response.statusCode !== 200) {
    return null;
  }

  const body = JSON.parse(response.body);

  return body.feed.entry[0];
}

module.exports = getConceptMetadata;