'use strict';

const mime = require('mime-types');
const KMS = require('@cumulus/aws-client/KMS');

const decrypt = async (ciphertext) => KMS.decryptBase64String(ciphertext);

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
  decrypt,
  lookupMimeType
};
