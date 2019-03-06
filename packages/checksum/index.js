'use strict';

const { generateChecksumFromStream } = require('./checksum');
const { validateChecksumFromStream } = require('./validate');

module.exports = {
  generateChecksumFromStream,
  validateChecksumFromStream
};
