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

// Calculate the cksum of a readable stream
async function getCksumFromStream(stream: Readable): Promise<string> {
  return await new Promise((resolve, reject) =>
    stream
      .pipe(cksum.stream((value: Buffer) => resolve(value.readUInt32BE(0).toString())))
      .on('error', reject));
}

// Calculate the hash of a readable stream using `crypto.createHash()`
async function getChecksumFromStream(
  algorithm: string,
  stream: Readable,
  options: TransformOptions = {}
): Promise<string> {
  const normalizedAlgorithm: string = normalizeHashAlgorithm(algorithm);
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash(normalizedAlgorithm, options);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Create <algorithm> file checksum from readable stream
 *
 * @param {string} algorithm - Checksum algorithm type
 * @param {stream.Readable} stream - A readable file stream
 * @param {Object} [options] - Checksum options, see `crypto.createHash()`
 *
 * @returns {Promise<number|string>} the file checksum
 *
 * @alias module:checksum.generateChecksumFromStream
 */
export async function generateChecksumFromStream(
  algorithm: string,
  stream: Readable,
  options?: TransformOptions
): Promise<number | string> {
  if (algorithm.toLowerCase() === 'cksum') {
    return await getCksumFromStream(stream);
  }

  return await getChecksumFromStream(algorithm, stream, options);
}
