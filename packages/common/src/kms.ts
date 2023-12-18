import AWS from 'aws-sdk';
import { createErrorType } from '@cumulus/errors';
import { deprecate } from './util';

const KMSDecryptionFailed = createErrorType('KMSDecryptionFailed');

export class KMS {
  static async encrypt(text: string, kmsId: string) {
    deprecate('@cumulus/common/key-pair-provider', '1.17.0', '@cumulus/aws-client/KMS.encrypt');

    const params = {
      KeyId: kmsId,
      Plaintext: text,
    };

    const kms = new AWS.KMS();
    const CiphertextBlob = await kms.encrypt(params);

    if (!CiphertextBlob) {
      throw new Error('Encryption failed, undefined CiphertextBlob returned');
    }

    return CiphertextBlob.toString();
  }

  static async decrypt(text: string) {
    deprecate('@cumulus/common/key-pair-provider', '1.17.0', '@cumulus/aws-client/KMS.decryptBase64String');

    const params = {
      CiphertextBlob: Buffer.from(text, 'base64'),
    };

    const kms = new AWS.KMS();
    try {
      const Plaintext = await kms.decrypt(params);

      if (!Plaintext) {
        throw new Error('Decryption failed, undefined Plaintext returned');
      }

      return Plaintext.toString();
    } catch (error) {
      if (error.toString().includes('InvalidCiphertextException')) {
        throw new KMSDecryptionFailed(
          'Decrypting the secure text failed. The provided text is invalid'
        );
      }
      throw error;
    }
  }
}
