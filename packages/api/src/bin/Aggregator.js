'use strict';

const { Transform } = require('stream');

/**
 * A transformer for an incoming stream that groups the messages
 * in batches of 25 or less (to comply with DynamoDB batchWrite limit)
 */
class Aggregator extends Transform {
  constructor() {
    super({ objectMode: true, highWaterMark: 100 });
    this.records = [];
  }

  /**
   * Is called by the Transform class when the incoming
   * stream ends to do clean up work
   *
   * @param {Function} cb - callback function
   * @returns {undefined} undefined
   */
  _final(cb) {
    if (this.records.length > 0) this.push(this.records);
    cb();
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
    if (!record) return;
    if (this.records.length === 25) {
      this.push(this.records);
      this.records = [record];
    } else {
      this.records.push(record);
    }
    callback();
  }
}

module.exports = Aggregator;
