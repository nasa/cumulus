'use strict';

const AWS = require('aws-sdk');

const errors = require('./errors');

const KMSDecryptionFailed = errors.createErrorType('KMSDecryptionFailed');

class KMS {
  static async encrypt(text, kmsId) {
    const params = {
      KeyId: kmsId,
      Plaintext: text
    };

    const kms = new AWS.KMS();
    const r = await kms.encrypt(params).promise();
    return r.CiphertextBlob.toString('base64');
  }

  static async decrypt(text) {
    const params = {
      CiphertextBlob: Buffer.from(text, 'base64')
    };

    const kms = new AWS.KMS();
    try {
      const r = await kms.decrypt(params).promise();
      return r.Plaintext.toString();
    } catch (e) {
      if (e.toString().includes('InvalidCiphertextException')) {
        throw new KMSDecryptionFailed(
          'Decrypting the secure text failed. The provided text is invalid'
        );
      }
      throw e;
    }
  }
}

module.exports = {
  KMS
};
