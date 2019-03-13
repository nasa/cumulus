/**
 * Provides encryption and decryption methods with a consistent API but
 * differing mechanisms for dealing with encryption keys.
 */

const forge = require('node-forge');

const { getS3Object } = require('./aws');
const { KMS } = require('./kms');
const log = require('./log');

/**
 * Provides encryption and decryption methods using a keypair stored in S3
 */
class S3KeyPairProvider {
  /**
   * Encrypt the given string using the given public key stored in the system_bucket.
   *
   * @param {string} str - The string to encrypt
   * @param {string} keyId - The name of the public key to use for encryption
   * @param {string} bucket - the optional bucket name. if not provided will
   *                          use env variable "system_bucket"
   * @param {stack} stack - the optional stack name. if not provided will
   *                        use env variable "stackName"
   * @returns {Promise} the encrypted string
   */
  static async encrypt(str, keyId = 'public.pub', bucket = null, stack = null) {
    // Download the publickey
    const pki = forge.pki;
    const pub = await this.retrieveKey(keyId, bucket, stack);

    const publicKey = pki.publicKeyFromPem(pub.Body.toString());
    return forge.util.encode64(publicKey.encrypt(str));
  }

  /**
   * Decrypt the given string using a private key stored in S3
   *
   * @param {string} str - The string to decrypt
   * @param {string} keyId - The name of the public key to use for decryption
   * @param {string} bucket - the optional bucket name. Defaults to the value of
   *   the "system_bucket" environment variable
   * @param {string} stack - the optional stack name. Defaults to the value of
   *   the "stackName" environment variable
   * @returns {Promise.<string>} the decrypted string
   */
  static async decrypt(str, keyId = 'private.pem', bucket = null, stack = null) {
    const pki = forge.pki;
    const priv = await this.retrieveKey(keyId, bucket, stack);

    const decoded = forge.util.decode64(str);
    const privateKey = pki.privateKeyFromPem(priv.Body.toString());
    return privateKey.decrypt(decoded);
  }

  static async retrieveKey(keyId = null, bucket = null, stack = null) {
    const b = bucket || process.env.system_bucket;
    const s = stack || process.env.stackName;
    try {
      const key = await getS3Object({
        Bucket: b, Key: `${s}/crypto/${keyId}`
      }).promise();
      return key;
    }
    catch (err) {
      log.error(`Failed to retrieve S3KeyPair key from bucket ${b} on stack ${s}`);
      throw err;
    }
  }
}

module.exports = {
  S3KeyPairProvider: S3KeyPairProvider,
  KMSProvider: KMS,
  // Use S3 by default. This will be the case until KMS is available in operations
  DefaultProvider: S3KeyPairProvider
};
