'use strict';

const readline = require('readline');
const pLimit = require('p-limit');
const { Transform } = require('stream');
const { Manager } = require('../models');

/**
 * A transformer for an incoming stream that writes the streams
 * to DynamoDB
 */
class Importer extends Transform {
  constructor(table, concurrencyLimit) {
    super({ objectMode: true, highWaterMark: 100 });
    this.model = new Manager({
      tableName: table,
      // This in an invalid hash but, since we don't know what the correct hash
      // is in this case, we need to use an empty one.  As long as
      // this.model.createTable() is never called on this Manager instance,
      // this _should_ work.  This should probably be re-implemented since
      // Manager is an abstract class and is not intended to be instantiated.
      tableHash: {},
      validate: false
    });
    this.promises = [];
    this.limit = pLimit(concurrencyLimit);
    this.count = 0;
  }

  /**
   * Override the _transform method of Transform class
   *
   * @param {Object} data - incoming stream object
   * @param {string} enc - encoding
   * @param {Function} callback - callback function
   * @returns {undefined} undefined
   */
  _transform(data, enc, callback) {
    if (!data) return;
    if (data.length > 25) throw new Error('Incoming array length must be 25 or less');
    this.count += data.length;

    this.promises.push(this.limit(() => {
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`Processing ${this.count} records\n`);
      return this.model.batchWrite(null, data);
    }));
    callback();
  }

  /**
   * Is called by the Transform class when the incoming
   * stream ends to do clean up work
   *
   * @param {Function} callback - callback function
   * @returns {undefined} undefined
   */
  _final(callback) {
    Promise.all(this.promises).then(() => {
      console.log(`Finished restoring ${this.count} records to DynamoDB`);
      callback();
    }).catch(callback);
  }
}

module.exports = Importer;
