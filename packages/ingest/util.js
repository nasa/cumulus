'use strict';

const mime = require('mime-types');
const KMS = require('@cumulus/aws-client/KMS');
const { S3KeyPairProvider } = require('@cumulus/common/key-pair-provider');

const decrypt = async (ciphertext) => {
  try {
    return await KMS.decryptBase64String(ciphertext);
  } catch (_) {
    return S3KeyPairProvider.decrypt(ciphertext);
  }
};

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
