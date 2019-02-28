'use strict';

const { generateChecksumFromStream } = require('./checksum');

/**
 * Validate expected checksum against calculated checksum
 *
 * @param {string} algorithm
 * @param {ReadableStream} stream
 * @param {string|number} expectedSum - expected checksum
 *
 * @returns {boolean} - whether expectedSum === calculatedSum
 */
async function validateChecksumFromStream(algorithm, stream, expectedSum) {
  const calculatedSum = generateChecksumFromStream(algorithm, stream);
  // Return false for fail. In future, throwing errors.InvalidChecksum would be preferable.
  // Currently this would introduce a cyclic dependency on common.
  return expectedSum === calculatedSum;
}

module.exports = {
  validateChecksumFromStream
};
