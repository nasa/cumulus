'use strict';

const get = require('lodash.get');
const pLimit = require('p-limit');
const { AttributeValue } = require('dynamodb-data-types');
const { log } = require('@cumulus/common');
const { FileClass } = require('../models');
const indexer = require('../es/indexer');
const { Search } = require('../es/search');
const unwrap = AttributeValue.unwrap;

const acceptedTables = ['Collection', 'Provider', 'Rule', 'Granule', 'Pdr', 'Execution'];

/**
 * Delete files associated with a given granule if the record belongs
 * to the granules table
 *
 * @param {string} table - dynamoDB table name
 * @param {Object} record - the dynamoDB record
 * @returns {Promise<undefined>} undefined
 */
async function performFilesDelete(table, record) {
  const granuleTable = `${process.env.stackName}-GranulesTable`;
  //make sure this is the granules table
  if (table === granuleTable) {
    const model = new FileClass();
    await model.deleteFilesOfGranule(record);
  }
}

/**
 * Add files of a given granule if the record is coming from
 * a granule table
 *
 * @param {string} table - dynamoDB table name
 * @param {Object} data - the new dynamoDB record
 * @param {Object} oldData - the old dynamoDB record
 * @returns {Promise<undefined>} undefined
 */
async function performFilesAddition(table, data, oldData) {
  const granuleTable = `${process.env.stackName}-GranulesTable`;
  if (table === granuleTable) {
    const model = new FileClass();

    // create files
    await model.createFilesFromGranule(data);

    // remove files that are no longer in the granule
    await model.deleteFilesAfterCompare(data, oldData);
  }
}

/**
 * return an object with the supported DynamoDB table names as key
 * and the elasticsearch indexer function as value
 *
 * @returns {Object} a dynamoDB to indexer map
 */
function getIndexers() {
  const stack = process.env.stackName;

  //determine whether the record should be indexed
  const indexers = {};
  acceptedTables.forEach((a) => {
    indexers[`${stack}-${a}sTable`] = indexer[`index${a}`];
  });

  return indexers;
}

/**
 * return the full of name of the dynamoDB table associated with incoming
 * record. The function returns empty response if the table name included
 * in the incoming message is not supported
 *
 * @param {string} sourceArn - the source arn included in the incoming message
 * @param {Object} indexers - A hash of table names and their indexers
 * @returns {string} name of the DynamoDB table
 */
function getTablename(sourceArn, indexers) {
  const tableName = sourceArn.match(/table\/(.[^\/]*)/);

  const tableIndex = Object.keys(indexers).indexOf(tableName[1]);
  if (!tableName || (tableName && tableIndex === -1)) {
    return undefined;
  }
  return tableName[1];
}

/**
 * Perform the record indexing
 *
 * @param {Object} indexers - A hash of table names and their indexers
 * @param {string} table - the DynamoDB table name
 * @param {Object} esClient - ElasticSearch connection client
 * @param {Object} data - the record to be indexed
 * @returns {Promise<Object>} elasticsearch response
 */
function performIndex(indexers, table, esClient, data) {
  return indexers[table](esClient, data);
}

/**
 * Perform the delete operation for the given record
 *
 * @param {Object} esClient - ElasticSearch connection client
 * @param {integer} tableIndex - the index number of table in the acceptable tables array
 * @param {Object} fields - a hash of table keys and hashes
 * @param {Object} body - the body of the record
 * @returns {Promise<Object>} elasticsearch response
 */
function performDelete(esClient, tableIndex, fields, body) {
  let id;
  let parent;
  const idKeys = Object.keys(fields);
  if (idKeys.length > 1) {
    id = indexer.constructCollectionId(...Object.values(fields));
  } else {
    id = fields[idKeys[0]];
  }

  const type = acceptedTables[tableIndex].toLowerCase();
  if (type === 'granule') {
    parent = body.collectionId;
  }

  return indexer
    .deleteRecord({ esClient, id, type, parent })
    // Important to catch this error. Uncaught errors will cause
    // the handler to fail and other records will not be updated.
    .catch((err) => log.error(err));
}

/**
 * Index a given record. The function will determine whether the records
 * has to be added, updated or deleted. It will also determine which index
 * to use
 *
 * @param {Object} esClient - ElasticSearch connection client
 * @param {Object} record - the record to be indexed
 * @returns {Promise<Object>} the record indexed
 */
async function indexRecord(esClient, record) {
  // only process if the source is dynamoDB
  if (record.eventSource !== 'aws:dynamodb') {
    return {};
  }

  // get list of indexers
  const indexers = getIndexers();
  const table = getTablename(record.eventSourceARN, indexers);

  if (!table) {
    return {};
  }

  // get the hash and range (if any) and use them as id key for ES
  const fields = unwrap(get(record, 'dynamodb.Keys'));
  const body = unwrap(get(record, 'dynamodb.NewImage'));
  const data = Object.assign({}, fields, body);

  const oldBody = unwrap(get(record, 'dynamodb.OldImage'));
  const oldData = Object.assign({}, fields, oldBody);

  if (record.eventName === 'REMOVE') {
    // delete from files associated with a granule
    await performFilesDelete(table, oldBody);

    return performDelete(esClient, Object.keys(indexers).indexOf(table), fields, oldBody);
  }

  // add files associated with a granule
  await performFilesAddition(table, data, oldData);

  return performIndex(indexers, table, esClient, data);
}

/**
 * Index incoming dynamoDB stream records
 *
 * @param {Array} records - aws DynamoDB records
 * @returns {Promise<Array>} array of records indexed
 */
async function indexRecords(records) {
  const concurrencyLimit = process.env.CONCURRENCY || 3;
  const limit = pLimit(concurrencyLimit);
  const esClient = await Search.es();

  const promises = records.map((record) => limit(() => indexRecord(esClient, record)));
  return Promise.all(promises);
}

/**
 * The main handler for the lambda function
 *
 * @param {Object} event - aws lambda event object.
 * @param {Object} context - aws context object
 * @param {Function} cb - aws callback
 * @returns {undefined} undefined
 */
function handler(event, context, cb) {
  const records = event.Records;
  if (!records) {
    return cb(null, 'No records found in event');
  }

  return indexRecords(records).then((r) => cb(null, r)).catch(cb);
}

module.exports = { handler };
