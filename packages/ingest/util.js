'use strict';

/**
 * Ensure provider path conforms to expectations.
 *
 * @param {string} provPath - provider path
 * @returns {string} path, updated to conform if necessary.
 */
function conformProviderPath(provPath) {
  if (provPath) {
    if (provPath[0] === '/') {
      return provPath.substr(1);
    }
    return provPath;
  }
  return '';
}

module.exports = {
  conformProviderPath
};
