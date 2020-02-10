'use strict';

const AWS = require('aws-sdk');
const { createErrorType } = require('@cumulus/errors');

const KMSDecryptionFailed = createErrorType('KMSDecryptionFailed');
const { deprecate } = require('./util');

class KMS {
  static async encrypt(text, kmsId) {
    deprecate('@cumulus/common/key-pair-provider', '1.17.0', '@cumulus/aws-client/KMS.encrypt');

    const params = {
      KeyId: kmsId,
      Plaintext: text
    };

    const kms = new AWS.KMS();
    const r = await kms.encrypt(params).promise();
    return r.CiphertextBlob.toString('base64');
  }

  static async decrypt(text) {
    deprecate('@cumulus/common/key-pair-provider', '1.17.0', '@cumulus/aws-client/KMS.decryptBase64String');

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
