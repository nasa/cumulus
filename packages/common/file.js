const cksum = require('cksum');

/**
 * Get file checksum from readable stream
 *
 * @param {ReadableStream} stream - A readable file stream
 *
 * @returns {Promise<number>} - Promise returning the file checksum
 */
async function getFileChecksumFromStream(stream) {
  return new Promise((resolve, reject) =>
    stream
      .pipe(cksum.stream((value) => resolve(value.readUInt32BE(0))))
      .on('error', reject));
}

module.exports = {
  getFileChecksumFromStream
};
