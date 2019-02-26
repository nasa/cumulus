'use strict';

const cksum = require('cksum');
const crypto = require('crypto');

/**
 * Get file checksum (cksum) from readable stream
 *
 * @param {ReadableStream} stream - A readable file stream
 *
 * @returns {Promise<number>} - Promise returning the file checksum
 */
async function _getCksumFromStream(stream) {
  return new Promise((resolve, reject) =>
    stream
      .pipe(cksum.stream((value) => resolve(value.readUInt32BE(0))))
      .on('error', reject));
}

/**
 * Get <algorithm> file checksum from readable stream
 *
 * @param {string} algorithm - Checksum algorithm
 * @param {ReadableStream} fileStream - A readable file stream
 * @param {Object} options - Checksum options
 *
 * @returns {Promise<number>} - Promise returning the file checksum
 */
async function _getChecksumFromStream(algorithm, fileStream, options) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm, options);
    fileStream.on('error', reject);
    fileStream.on('data', (chunk) => hash.update(chunk));
    fileStream.on('end', () => resolve(hash.digest('hex')));
  });
}


/**
 * Create <algorithm> file checksum from readable stream
 *
 * @param {string} algorithm - Checksum algorithm
 * @param {ReadableStream} fileStream - A readable file stream
 * @param {Object} options - Checksum options
 *
 * @returns {Promise<number>} - Promise returning the file checksum
 */
function checksumFileStream(algorithm, fileStream, options) {
  if (algorithm.toLowerCase() === 'cksum') {
    return _getCksumFromStream(fileStream);
  }
  return _getChecksumFromStream(algorithm, fileStream, options);
}

module.exports = {
  checksumFileStream
};
