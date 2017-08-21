/**
 * Provides encryption and decryption methods with a consistent API but
 * differing mechanisms for dealing with encryption keys.
 */

const forge = require('node-forge');
const { S3, KMS } = require('./aws').S3;

/**
 * Provides encryption and decryption methods using a keypair stored in S3
 */
class S3KeyPairProvider {
  /**
   * Encrypt the given string using the given public key stored in the internal bucket
   * @param {String} - The string to encrypt
   * @param {String} - The name of the public key to use for encryption
   * @return the decrypted string
   */
  static async encrypt(str, keyId = 'public.pub') {
    // Download the publickey
    const pki = forge.pki;
    const pub = await S3.get(
      process.env.internal,
      `${process.env.StackName}-${process.env.Stage}/crypto/${keyId}`
    );

    const publicKey = pki.publicKeyFromPem(pub.Body.toString());
    return publicKey.encrypt(str);
  }

  /**
   * Decrypt the given string using the given private key stored in the internal bucket
   * @param {String} - The encrypted string to decrypt
   * @param {String} - The name of the private key to use for decryption
   * @return the decrypted string
   */
  static async decrypt(str, keyId = 'private.pem') {
    const pki = forge.pki;
    const priv = await S3.get(
      process.env.internal,
      `${process.env.StackName}-${process.env.Stage}/crypto/${keyId}`
    );

    const privateKey = pki.privateKeyFromPem(priv.Body.toString());
    return privateKey.decrypt(str);
  }
}

module.exports = {
  S3KeyPairProvider: S3KeyPairProvider,
  KmsProvider: KMS,
  // Use S3 by default. This will be the case until KMS is available in operations
  DefaultProvider: S3KeyPairProvider
};
