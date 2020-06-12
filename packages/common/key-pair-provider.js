/**
 * Provides encryption and decryption methods with a consistent API but
 * differing mechanisms for dealing with encryption keys.
 */

const { KMS } = require('./kms');

module.exports = { KMSProvider: KMS };
