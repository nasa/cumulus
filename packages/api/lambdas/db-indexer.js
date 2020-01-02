'use strict';

const get = require('lodash.get');
const pMap = require('p-map');
const { AttributeValue } = require('dynamodb-data-types');
const { constructCollectionId } = require('@cumulus/common/collection-config-store');
const log = require('@cumulus/common/log');
const FileClass = require('../models/files');
const indexer = require('../es/indexer');
const { Search } = require('../es/search');
const unwrap = AttributeValue.unwrap;

/**
 * Get the index details to use for indexing data from the given
 * DynamoDB table.
 *
 * @param {string} tableName - DynamoDB table name
 * @returns {Object} Index details to use for the table
 */
const getTableIndexDetails = (tableName) => {
  const indexTables = {
    [process.env.CollectionsTable]: {
      indexFnName: 'indexCollection',
      indexType: 'collection'
    },
    [process.env.ExecutionsTable]: {
      indexFnName: 'indexExecution',
      indexType: 'execution'
    },
    [process.env.GranulesTable]: {
      indexFnName: 'indexGranule',
      indexType: 'granule'
    },
    [process.env.PdrsTable]: {
      indexFnName: 'indexPdr',
      indexType: 'pdr'
    },
    [process.env.ProvidersTable]: {
      indexFnName: 'indexProvider',
      indexType: 'provider'
    },
    [process.env.RulesTable]: {
      indexFnName: 'indexRule',
      indexType: 'rule'
    }
  };
  return indexTables[tableName];
};

/**
 * Delete files associated with a given granule.
 *
 * @param {Object} record - the dynamoDB record
 * @returns {Promise<undefined>} undefined
 */
async function performFilesDelete(record) {
  const fileClass = new FileClass();
  await fileClass.deleteFilesOfGranule(record);
}

/**
 * Add files of a given granule.
 *
 * @param {Object} data - the new dynamoDB record
 * @param {Object} oldData - the old dynamoDB record
 * @returns {Promise<undefined>} undefined
 */
async function performFilesAddition(data, oldData) {
  const fileClass = new FileClass();

  // create files
  await fileClass.createFilesFromGranule(data);

  // remove files that are no longer in the granule
  await fileClass.deleteFilesAfterCompare(data, oldData);
}

/**
 * Return the full of name of the DynamoDB table associated with incoming
 * record.
 *
 * @param {string} sourceArn - the source arn included in the incoming message
 * @returns {undefined|string} name of the DynamoDB table
 */
function getTableName(sourceArn) {
  const tableName = sourceArn.match(/table\/(.[^\/]*)/);
  if (!tableName) {
    return undefined;
  }
  return tableName[1];
}

/**
 * Perform the record indexing
 *
 * @param {string} indexFnName - Function name to index the record to Elasticsearch
 * @param {Object} esClient - ElasticSearch connection client
 * @param {Object} data - the record to be indexed
 * @returns {Promise<Object>} elasticsearch response
 */
function performIndex(indexFnName, esClient, data) {
  return indexer[indexFnName](esClient, data, process.env.ES_INDEX);
}

/**
 * Perform the delete operation for the given record
 *
 * @param {Object} esClient - ElasticSearch connection client
 * @param {string} type - type of record to index
 * @param {Object} fields - a hash of table keys and hashes
 * @param {Object} body - the body of the record
 * @returns {Promise<Object>} elasticsearch response
 */
function performDelete(esClient, type, fields, body) {
  let id;
  let parent;
  const idKeys = Object.keys(fields);
  if (idKeys.length > 1) {
    id = constructCollectionId(...Object.values(fields));
  } else {
    id = fields[idKeys[0]];
  }

  if (type === 'granule') {
    parent = body.collectionId;
  }

  return indexer
    .deleteRecord({
      esClient,
      id,
      type,
      parent,
      index: process.env.ES_INDEX
    });
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
  if (record.eventSource !== 'aws:dynamodb') return {};

  const tableName = getTableName(record.eventSourceARN);
  if (!tableName) return {};

  const tableIndexDetails = getTableIndexDetails(tableName);

  // Check if data from table name is suported for indexing.
  if (!tableIndexDetails) return {};

  const { indexFnName, indexType } = tableIndexDetails;

  // get the hash and range (if any) and use them as id key for ES
  const fields = unwrap(get(record, 'dynamodb.Keys'));
  const body = unwrap(get(record, 'dynamodb.NewImage'));
  const data = Object.assign({}, fields, body);

  const oldBody = unwrap(get(record, 'dynamodb.OldImage'));
  const oldData = Object.assign({}, fields, oldBody);

  if (record.eventName === 'REMOVE') {
    // delete from files associated with a granule
    if (indexType === 'granule') await performFilesDelete(oldBody);
    return performDelete(esClient, indexType, fields, oldBody);
  }

  // add files associated with a granule
  if (indexType === 'granule') await performFilesAddition(data, oldData);
  return performIndex(indexFnName, esClient, data);
}

/**
 * Index incoming dynamoDB stream records
 *
 * @param {Array} records - aws DynamoDB records
 * @returns {Promise<Array>} array of records indexed
 */
async function indexRecords(records) {
  const esClient = await Search.es();

  return pMap(
    records,
    (record) => indexRecord(esClient, record).catch(log.error),
    { concurrency: process.env.CONCURRENCY || 3 }
  );
}

/**
 * The main handler for the lambda function
 *
 * @param {Object} event - aws lambda event object.
 */
const handler = async ({ Records }) =>
  (Records ? indexRecords(Records) : 'No records found in event');

module.exports = {
  getTableName,
  getTableIndexDetails,
  handler
};
