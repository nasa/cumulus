'use strict';

const { Transform } = require('stream');

/**
 * A transformer for an incoming stream that parses JSON strings and
 * add them to the buffer
 */
class Parser extends Transform {
  constructor() {
    super({ objectMode: true, highWaterMark: 100 });
  }

  /**
   * Override the _transform method of Transform class
   *
   * @param {Object} record - incoming stream object
   * @param {string} enc - encoding
   * @param {Function} callback - callback function
   * @returns {undefined} undefined
   */
  _transform(record, enc, callback) {
    if (!record || record.length === 0) return;
    this.push(JSON.parse(record.toString()));
    callback();
  }
}

module.exports = Parser;
