import { Readable, TransformOptions } from 'stream';
import { generateChecksumFromStream } from './checksum';

/**
 * Validate expected checksum against calculated checksum
 *
 * @param algorithm - Checksum algorithm
 * @param stream - A readable file stream
 * @param expectedSum - expected checksum
 * @param options - Checksum options
 *
 * @returns whether expectedSum === calculatedSum
 */
export async function validateChecksumFromStream(
  algorithm: string,
  stream: Readable,
  expectedSum: string,
  options: TransformOptions = {}
): Promise<boolean> {
  const calculatedSum = await generateChecksumFromStream(algorithm, stream, options);
  return expectedSum === calculatedSum;
}

export default validateChecksumFromStream;
