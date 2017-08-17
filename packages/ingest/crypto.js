const forge = require('node-forge');
const { S3, KMS } = require('./aws').S3;

class S3KeyPairProvider {
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
  DefaultProvider: S3KeyPairProvider
};
