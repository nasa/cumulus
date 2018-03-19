'use strict';

const get = require('lodash.get');
const pLimit = require('p-limit');
const { AttributeValue } = require('dynamodb-data-types');
const indexer = require('../es/indexer');
const { Search } = require('../es/search');
const unwrap = AttributeValue.unwrap;

function indexRecord(esClient, record) {
  // only process if the source is dynamoDB
  if (record.eventSource !== 'aws:dynamodb') {
    return Promise.resolve();
  }

  const stack = process.env.stackName;

  //determine whether the record should be indexed
  const acceptedTables = ['Collection', 'Provider', 'Rule'];
  const tableConfig = {};
  acceptedTables.forEach((a) => {
    tableConfig[`${stack}-${a}sTable`] = indexer[`index${a}`];
  });

  let tableName = record.eventSourceARN.match(/table\/(.[^\/]*)/);

  const tableIndex = Object.keys(tableConfig).indexOf(tableName[1]);
  if (!tableName || (tableName && tableIndex === -1)) {
    return Promise.resolve();
  }
  tableName = tableName[1];
  const currentTable = acceptedTables[tableIndex].toLowerCase();

  // now get the hash and range (if any) and use them as id key for ES
  const keys = unwrap(get(record, 'dynamodb.Keys'));
  const body = unwrap(get(record, 'dynamodb.NewImage'));
  const data = Object.assign({}, keys, body);

  if (record.eventName === 'REMOVE') {
    let id;
    const idKeys = Object.keys(keys);
    if (idKeys.length > 1) {
      id = indexer.constructCollectionId(...Object.values(keys));
    }
    else {
      id = keys[idKeys[0]];
    }
    return indexer
      .deleteRecord(esClient, id, currentTable)
      // Important to catch this error. Uncaught errors will cause the handler to fail and other records will not be updated.
      .catch(console.log);
  }
  return tableConfig[tableName](esClient, data);
}

async function indexRecords(records) {
  const concurrencyLimit = process.env.CONCURRENCY || 3;
  const limit = pLimit(concurrencyLimit);
  const esClient = await Search.es();

  const promises = records.map((record) => limit(() => indexRecord(esClient, record)));
  return Promise.all(promises);
}

/**
 * Sync changes to dynamodb to an elasticsearch instance.
 * Sending updates to this lambda is handled by automatically AWS.
 *
 * @param {Array} Records - list of records with an eventName property signifying REMOVE or INSERT.
 * @returns {string} response text indicating the number of records altered in elasticsearch.
 */
function handler(event, context, cb) {
  const records = event.Records;
  if (!records) {
    return cb(null, 'No records found in event');
  }

  return indexRecords(records).then((r) => cb(null, r)).catch(cb);
}

module.exports = handler;
