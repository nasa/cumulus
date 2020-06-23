'use strict';

const fs = require('fs');
const split = require('split2');
const Aggregator = require('./Aggregator');
const Importer = require('./Importer');
const Parser = require('./Parser');

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
