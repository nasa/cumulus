import { Readable, TransformOptions } from 'stream';
import { generateChecksumFromStream } from './checksum';

/**
 * Validate expected checksum against calculated checksum
 *
 * @param {string} algorithm - Checksum algorithm
 * @param {stream.Readable} stream - A readable file stream
 * @param {number|string} expectedSum - expected checksum
 * @param {Object} [options] - Checksum options
 *
 * @returns {Promise<boolean>} whether expectedSum === calculatedSum
 *
 * @alias module:checksum.validateChecksumFromStream
 */
export async function validateChecksumFromStream(
  algorithm: string,
  stream: Readable,
  expectedSum: string | number,
  options: TransformOptions = {}
): Promise<boolean> {
  const calculatedSum = await generateChecksumFromStream(algorithm, stream, options);
  return expectedSum.toString() === calculatedSum.toString();
}
