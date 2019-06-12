'use strict';

const get = require('lodash.get');
const isInteger = require('lodash.isinteger');
const isObject = require('lodash.isobject');

function errorify(err) {
  return JSON.stringify(err, Object.getOwnPropertyNames(err));
}

/**
 * Ensures that the exception is returned as an object
 *
 * @param {*} exception - the exception
 * @returns {string} an stringified exception
 */
function parseException(exception) {
  // null is considered object
  if (exception === null) {
    return {};
  }

  if (!isObject(exception)) {
    const converted = JSON.stringify(exception);
    if (converted === 'undefined') {
      return {};
    }
    return { Error: 'Unknown Error', Cause: converted };
  }
  return exception;
}

/**
 * Returns the name and version of a collection based on
 * the collectionId used in elasticsearch indexing
 *
 * @param {string} collectionId - collectionId used in elasticsearch index
 * @returns {Object} name and version as object
 */
function deconstructCollectionId(collectionId) {
  const [name, version] = collectionId.split('___');
  return {
    name,
    version
  };
}

/**
 * Extract a date from the payload and return it in string format
 *
 * @param {Object} payload - payload object
 * @param {string} dateField - date field to extract
 * @returns {string} - date field in string format, null if the
 * field does not exist in the payload
 */
function extractDate(payload, dateField) {
  const dateMs = get(payload, dateField);

  if (dateMs) {
    const date = new Date(dateMs);
    return date.toISOString();
  }

  return undefined;
}

/**
 * Calculate granule product volume, which is the sum of the file
 * sizes in bytes
 *
 * @param {Array<Object>} granuleFiles - array of granule files
 * @returns {Integer} - sum of granule file sizes in bytes
 */
function getGranuleProductVolume(granuleFiles = []) {
  return granuleFiles
    .map((f) => f.size)
    .filter(isInteger)
    .reduce((x, y) => x + y, 0);
}

module.exports = {
  deconstructCollectionId,
  errorify,
  extractDate,
  getGranuleProductVolume,
  parseException
};
