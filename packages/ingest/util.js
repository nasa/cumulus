'use strict';

const mime = require('mime-types');

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
  lookupMimeType
};
