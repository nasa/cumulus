import * as cksum from 'cksum';
import * as crypto from 'crypto';
import { Readable, TransformOptions } from 'stream';

/**
 * Get file checksum (cksum) from readable stream
 *
 * @param stream - A readable file stream
 *
 * @returns The file checksum
 */
async function _getCksumFromStream(stream: Readable): Promise<number> {
  return new Promise((resolve, reject) =>
    stream
      .pipe(cksum.stream((value: Buffer) => resolve(value.readUInt32BE(0))))
      .on('error', reject));
}

/**
 * Get <algorithm> file checksum from readable stream
 *
 * @param algorithm - algorithm to use for hash, any algorithm accepted by node's
 * `crypto.createHash` https://nodejs.org/api/crypto.html#crypto_crypto_createhash_algorithm_options
 * @param stream - A readable file stream
 * @param options - Checksum options
 *
 * @returns Promise returning the file checksum
 */
async function _getChecksumFromStream(
  algorithm: string,
  stream: Readable,
  options: TransformOptions = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm, options);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Create <algorithm> file checksum from readable stream
 *
 * @param algorithm - Checksum algorithm
 * @param stream - A readable file stream
 * @param options - Checksum options
 *
 * @returns Promise returning the file checksum
 */
export function generateChecksumFromStream(
  algorithm: string,
  stream: Readable,
  options: TransformOptions
): Promise<number | string> {
  if (algorithm.toLowerCase() === 'cksum') {
    return _getCksumFromStream(stream);
  }

  return _getChecksumFromStream(algorithm, stream, options);
}

export default generateChecksumFromStream;
