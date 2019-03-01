'use strict';

const { generateChecksumFromStream } = require('./checksum');

/**
 * Validate expected checksum against calculated checksum
 *
 * @param {string} algorithm - Checksum algorithm
 * @param {ReadableStream} stream - A readable file stream
 * @param {string|number} expectedSum - expected checksum
 * @param {Object} options - Checksum options
 *
 * @returns {boolean} - whether expectedSum === calculatedSum
 */
async function validateChecksumFromStream(algorithm, stream, expectedSum, options = {}) {
  const calculatedSum = generateChecksumFromStream(algorithm, stream, options);
  return expectedSum === calculatedSum;
}

module.exports = {
  validateChecksumFromStream
};
