import mime from 'mime-types';
import * as KMS from '@cumulus/aws-client/KMS';
import { S3KeyPairProvider } from '@cumulus/common/key-pair-provider';

export const decrypt = async (
  ciphertext: string
): Promise<string | undefined> => {
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
 * @returns {string|undefined} mimeType or undefined
 */
export function lookupMimeType(key: string): string | undefined {
  return mime.lookup(key) || undefined;
}
