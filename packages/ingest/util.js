'use strict';

const mime = require('mime-types');

/**
 * Ensure provider path conforms to expectations.
 * Removes any/all leading forward slashes.
 *
 * @param {string} provPath - provider path
 * @returns {string} path, updated to conform if necessary.
 */
function normalizeProviderPath(provPath) {
  if (provPath) {
    const leadingSlashRegex = /^\/*/g;
    return provPath.replace(leadingSlashRegex, '');
  }
  return '';
}

/**
 * Return mime-type based on input url or filename
 *
 * @param {string} key
 * @returns {string} mimeType or null
 */
function lookupMimeType(key) {
  return mime.lookup(key) || null;
}

module.exports = {
  normalizeProviderPath,
  lookupMimeType
};
