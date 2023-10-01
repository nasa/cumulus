import * as cksum from 'cksum';
import * as crypto from 'crypto';
import { Readable, TransformOptions } from 'stream';

export function normalizeHashAlgorithm(algorithm: string): string {
  switch (algorithm) {
    case 'SHA-1':
      return 'SHA1';
    case 'SHA-2':
      return 'SHA2';
    case 'SHA-256':
      return 'SHA256';
    case 'SHA-384':
      return 'SHA384';
    case 'SHA-512':
      return 'SHA512';
    default:
      return algorithm;
  }
}

/**
 * Calculate the cksum of a readable stream.
 * @param stream - The readable stream to calculate cksum for.
 * @returns The cksum as a string.
 */
async function getCksumFromStream(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    stream
        .pipe(cksum.stream((value: Buffer) => resolve(value.readUInt32BE(0).toString())))
        .on('error', reject);
  });
}

/**
 * Calculate the hash of a readable stream using `crypto.createHash()`.
 * @param algorithm - The hash algorithm to use.
 * @param stream - The readable stream to calculate the hash for.
 * @param options - Options for the hash algorithm.
 * @returns The hash as a hexadecimal string.
 */
async function getChecksumFromStream(
    algorithm: string,
    stream: Readable,
    options: TransformOptions = {}
): Promise<string> {
  const normalizedAlgorithm: string = normalizeHashAlgorithm(algorithm);

  if (!crypto.getHashes().includes(normalizedAlgorithm)) {
    throw new Error(`Unsupported hash algorithm: ${algorithm}`);
  }

  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(normalizedAlgorithm, options);
    stream
        .on('error', reject)
        .on('data', (chunk) => hash.update(chunk))
        .on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Create a file checksum from a readable stream using the specified algorithm.
 * @param algorithm - The checksum algorithm type.
 * @param stream - A readable file stream.
 * @param options - Checksum options, see `crypto.createHash()`.
 * @returns The file checksum.
 */
export async function generateChecksumFromStream(
    algorithm: string,
    stream: Readable,
    options?: TransformOptions
): Promise<string> {
  if (algorithm.toLowerCase() === 'cksum') {
    return await getCksumFromStream(stream);
  }

  return await getChecksumFromStream(algorithm, stream, options);
}