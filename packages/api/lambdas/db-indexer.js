'use strict';

const get = require('lodash/get');
const pEachSeries = require('p-each-series');
const { AttributeValue } = require('dynamodb-data-types');
const Logger = require('@cumulus/logger');
const indexer = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
const unwrap = AttributeValue.unwrap;

const logger = new Logger({ sender: '@cumulus/dbIndexer' });

/**
 * Get the index details to use for indexing data from the given
 * DynamoDB table.
 *
 * @param {string} tableName - DynamoDB table name
 * @returns {Object} Index details to use for the table
 */
const getTableIndexDetails = (tableName) => {
  const indexTables = {
    [process.env.ReconciliationReportsTable]: {
      indexFnName: 'indexReconciliationReport',
      deleteFnName: 'deleteReconciliationReport',
      indexType: 'reconciliationReport',
    },
  };
  return indexTables[tableName];
  // TODO: this is being flagged for removal for CollectionsTable
  // This entire file looks like it is focused on Dynamo tables, can this whole file be removed
  // with the last Dynamo table, or is there later cleanup planned?
};

/**
 * Get the ID field name for a given record type.
 *
 * @param {string} type - type of record to index
 * @returns {string} ID field name
 */
const mapIndexTypeToIdFieldName = (type) => {
  const idFieldsByType = {
    reconciliationReport: 'name',
  };
  return idFieldsByType[type];
};

/**
 * Return the full of name of the DynamoDB table associated with incoming
 * record.
 *
 * @param {string} sourceArn - the source arn included in the incoming message
 * @returns {undefined|string} name of the DynamoDB table
 */
function getTableName(sourceArn) {
  const tableName = sourceArn.match(/table\/(.[^/]*)/);
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
  const idFieldName = mapIndexTypeToIdFieldName(type);
  return record[idFieldName];
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
  // TODO: I don't think `process.env.ES_INDEX` is ever set and can be
  // removed
  return indexer[indexFnName](esClient, data, process.env.ES_INDEX);
}

/**
 * Perform the delete operation for the given record
 *
 * @param {string} deleteFnName - Delete function name
 * @param {Object} esClient     - Elasticsearch connection client
 * @param {string} type         - Type of record to index
 * @param {string} id           - Record ID
 * @param {string} parentId     - ID of parent record
 * @returns {Promise<Object>}   - Elasticsearch response
 */
function performDelete(deleteFnName, esClient, type, id) {
  logger.debug(`deleting type: ${type} id: ${id}`);

  const idFieldName = mapIndexTypeToIdFieldName(type);
  const deleteParams = {
    esClient,
    [idFieldName]: id,
    type,
    index: process.env.ES_INDEX,
  };
  return indexer[deleteFnName](deleteParams);
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

  // Check if data from table name is supported for indexing.
  if (!tableIndexDetails) return {};

  const { deleteFnName, indexFnName, indexType } = tableIndexDetails;

  const keys = unwrap(get(record, 'dynamodb.Keys'));
  const data = unwrap(get(record, 'dynamodb.NewImage'));

  const id = getRecordId(indexType, keys);

  if (record.eventName === 'REMOVE') {
    logger.debug(`about to remove ${indexType}, id: ${id}`);
    const deletedObject = await performDelete(
      deleteFnName,
      esClient,
      indexType,
      id
    );
    logger.debug(`finished removing ${indexType}, id: ${id}`);
    return deletedObject;
  }

  logger.debug(`about to index ${indexType}, id: ${id}`);
  const response = await performIndex(indexFnName, esClient, data);
  logger.debug(`finished indexing ${indexType}, id: ${id}`);
  return response;
}

/**
 * Index incoming dynamoDB stream records
 *
 * @param {Array} records - aws DynamoDB records
 * @returns {Promise<Array>} array of records indexed
 */
async function indexRecords(records) {
  const esClient = await Search.es();

  return pEachSeries(
    records,
    (record) => indexRecord(esClient, record).catch((error) => logger.error(error))
  );
}

/**
 * The main handler for the lambda function
 *
 * @param {Object} event - aws lambda event object.
 */
const handler = async ({ Records }) =>
  (Records ? await indexRecords(Records) : 'No records found in event');

module.exports = {
  getTableName,
  getTableIndexDetails,
  getRecordId,
  handler,
  performDelete,
  performIndex,
};
