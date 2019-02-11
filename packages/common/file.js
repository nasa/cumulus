const cksum = require('cksum');

async function getChecksumFromStream(stream) {
  return new Promise((resolve, reject) =>
    stream
      .pipe(cksum.stream((value) => resolve(value.readUInt32BE(0))))
      .on('error', reject));
}

module.exports = {
  getChecksumFromStream
};
