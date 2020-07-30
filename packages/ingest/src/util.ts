import mime from 'mime-types';
import * as KMS from '@cumulus/aws-client/KMS';

export const decrypt = async (
  ciphertext: string
): Promise<string | undefined> =>
  KMS.decryptBase64String(ciphertext);

/**
 * Return mime-type based on input url or filename
 *
 * @param {string} key
 * @returns {string|undefined} mimeType or undefined
 */
export function lookupMimeType(key: string): string | undefined {
  return mime.lookup(key) || undefined;
}
