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
 * Get the ID field name for a given record type.
 *
 * @param {string} type - type of record to index
 * @returns {string} ID field name
 */
const mapIndexTypeToIdFieldName = (type) => {
  const idFieldsByType = {
    execution: 'arn',
    granule: 'granuleId',
    pdr: 'pdrName',
    provider: 'id',
    rule: 'name'
  };
  return idFieldsByType[type];
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
 * Get record ID.
 *
 * @param {string} type - type of record to index
 * @param {Object} record - the record to be indexed
 * @returns {string} record ID
 */
function getRecordId(type, record) {
  if (type === 'collection') {
    return constructCollectionId(record.name, record.version);
  }
  const idFieldName = mapIndexTypeToIdFieldName(type);
  return record[idFieldName];
}

/**
 * Get parent record ID.
 *
 * @param {string} type - type of record to index
 * @param {Object} record - the record to be indexed
 * @returns {string} record ID
 */
function getParentId(type, record) {
  if (type === 'granule') {
    return record.collectionId;
  }
  return null;
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
 * @param {string} id - record ID
 * @param {string} parentId - ID of parent record
 * @returns {Promise<Object>} elasticsearch response
 */
function performDelete(esClient, type, id, parentId) {
  return indexer
    .deleteRecord({
      esClient,
      id,
      type,
      parent: parentId,
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

  const keys = unwrap(get(record, 'dynamodb.Keys'));
  const data = unwrap(get(record, 'dynamodb.NewImage'));
  const oldData = unwrap(get(record, 'dynamodb.OldImage'));

  const id = getRecordId(indexType, keys);

  if (record.eventName === 'REMOVE') {
    // delete from files associated with a granule
    if (indexType === 'granule') await performFilesDelete(oldData);
    const parentId = getParentId(indexType, oldData);
    return performDelete(esClient, indexType, id, parentId);
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
  getParentId,
  getRecordId,
  handler,
  performFilesAddition,
  performFilesDelete,
  performDelete,
  performIndex
};
