'use strict';

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

module.exports = {
  normalizeProviderPath
};
