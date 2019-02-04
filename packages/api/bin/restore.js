'use strict';

const fs = require('fs');
const readline = require('readline');
const split = require('split2');
const pLimit = require('p-limit');
const { Transform } = require('stream');
const { Manager } = require('../models');

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
    }
    else {
      this.records.push(record);
    }
    callback();
  }
}

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


/**
 * restore records to a DynamoDB table from a json file
 *
 * @param {string} filePath - path to the json file
 * @param {string} table - name of the dynamoDB table
 * @param {integer} concurrency - number of concurrent calls to DynamoDB
 * @returns {Promise} returns a promise
 */
function restore(filePath, table, concurrency = 2) {
  return new Promise((resolve, reject) => {
    const src = fs.createReadStream(filePath);
    console.log(`Started restore of records to ${table} from ${filePath}`);
    return src.pipe(split())
      .pipe(new Parser())
      .pipe(new Aggregator())
      .pipe(new Importer(table, concurrency))
      .on('error', reject)
      .on('finish', () => resolve('Restore is completed'));
  });
}

module.exports = restore;
