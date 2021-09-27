import mime from 'mime-types';
import * as KMS from '@cumulus/aws-client/KMS';
import { S3KeyPairProvider } from '@cumulus/common/key-pair-provider';

import Logger from '@cumulus/logger';

const logger = new Logger({ sender: '@cumulus/ingest/util' });

export const decrypt = async (
  ciphertext: string
): Promise<string | undefined> => {
  try {
    return await KMS.decryptBase64String(ciphertext);
  } catch (error) {
    logger.error('Could not decrypt secret with KMS', error);
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
