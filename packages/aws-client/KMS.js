'use strict';

const { kms } = require('./services');

/**
 * Create a KMS key
 *
 * See https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/KMS.html#createKey-property
 * for allowed params and return value.
 *
 * @param {Object} params
 * @returns {Promise<Object>}
 */
const createKey = (params = {}) => kms().createKey(params).promise();

/**
 * Encrypt a string using KMS
 *
 * @param {string} KeyId - the KMS key to use for encryption
 * @param {string} Plaintext - the string to be encrypted
 * @returns {Promise<string>} the Base 64 encoding of the encrypted value
 */
const encrypt = (KeyId, Plaintext) =>
  kms().encrypt({ KeyId, Plaintext }).promise()
    .then(({ CiphertextBlob }) => CiphertextBlob.toString('base64'));

/**
 * Decrypt a KMS-encrypted string, Base 64 encoded
 *
 * @param {string} ciphertext - a KMS-encrypted value, Base 64 encoded
 * @returns {string} the plaintext
 */
const decryptBase64String = (ciphertext) =>
  kms().decrypt({
    CiphertextBlob: Buffer.from(ciphertext, 'base64')
  }).promise()
    .then(({ Plaintext }) => Plaintext.toString());

module.exports = {
  createKey,
  decryptBase64String,
  encrypt
};
