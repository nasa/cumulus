/* functions for transforming and indexing Cumulus Payloads
 * in ElasticSearch. These functions are specifically designed
 * to transform data for use in cumulus api
 *
 * The module accepts the following kinds of workflows (state machines):
 * - ParsePdrs
 * - IngestGranules
 * - StateMachine (if a payload doesn't belong to previous ones)
 */

'use strict';

const cloneDeep = require('lodash.clonedeep');
const curry = require('lodash.curry');
const flatten = require('lodash.flatten');
const isEmpty = require('lodash.isempty');
const isString = require('lodash.isstring');
const zlib = require('zlib');
const log = require('@cumulus/common/log');
const { inTestMode } = require('@cumulus/common/test-utils');
const { constructCollectionId } = require('@cumulus/common');
const { dynamodb } = require('@cumulus/common/aws');
const { isNil, isNotNil } = require('@cumulus/common/util');

const DynamoDB = require('../lib/DynamoDB');
const { Search, defaultIndexAlias } = require('./search');
const { deconstructCollectionId } = require('../lib/utils');
const { Granule, Pdr, Execution } = require('../models');

/**
 * Extracts info from a stepFunction message and indexes it to
 * an ElasticSearch
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {Array} payloads  - an array of log payloads
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: granule)
 * @returns {Promise} Elasticsearch response
 */
async function indexLog(esClient, payloads, index = defaultIndexAlias, type = 'logs') {
  const body = [];

  payloads.forEach((p) => {
    body.push({ index: { _index: index, _type: type, _id: p.id } });
    let record;
    try {
      // cumulus log message has extra aws messages before the json message,
      // only the json message should be logged to elasticsearch.
      // example message:
      // 2018-06-01T17:45:27.108Z a714a0ef-f141-4e52-9661-58ca2233959a
      // {"level": "info", "timestamp": "2018-06-01T17:45:27.108Z",
      // "message": "uploaded s3://bucket/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met"}
      const entryParts = p.message.trim().split('\t');
      // cumulus log message
      if (entryParts.length >= 3 && entryParts[2].startsWith('{')
      && entryParts[entryParts.length - 1].endsWith('}')) {
        record = JSON.parse(entryParts.slice(2).join('\t'));
        record.RequestId = entryParts[1];
      }
      else { // other logs e.g. cumulus-ecs-task
        record = JSON.parse(p.message);
      }
      // level is number in elasticsearch
      if (isString(record.level)) record.level = log.convertLogLevel(record.level);
    }
    catch (e) {
      record = {
        message: p.message.trim(),
        sender: p.sender,
        executions: p.executions,
        timestamp: p.timestamp,
        version: p.version,
        level: 30,
        pid: 1,
        name: 'cumulus'
      };
    }
    body.push(record);
  });

  const actualEsClient = esClient || (await Search.es());
  return actualEsClient.bulk({ body: body });
}

/**
 * Partially updates an existing ElasticSearch record
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {string} id       - id of the Elasticsearch record
 * @param  {string} type     - Elasticsearch type (default: execution)
 * @param  {Object} doc      - Partial updated document
 * @param  {string} parent   - id of the parent (optional)
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {boolean} upsert  - whether to upsert the document
 * @returns {Promise} elasticsearch update response
 */
async function partialRecordUpdate(
  esClient,
  id,
  type,
  doc,
  parent,
  index = defaultIndexAlias,
  upsert = false
) {
  if (!doc) throw new Error('Nothing to update. Make sure doc argument has a value');

  const docWithTimestamp = Object.assign(
    cloneDeep(doc),
    { timestamp: Date.now }
  );

  const params = {
    index,
    type,
    id,
    refresh: inTestMode(),
    body: {
      doc: docWithTimestamp
    }
  };

  if (parent) params.parent = parent;
  if (upsert) params.body.doc_as_upsert = upsert;

  const actualEsClient = esClient || (await Search.es());
  return actualEsClient.update(params);
}

/**
 * Indexes a given record to the specified ElasticSearch index and type
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {string} id       - the record id
 * @param  {Object} doc      - the record
 * @param  {string} index    - Elasticsearch index alias
 * @param  {string} type     - Elasticsearch type
 * @param  {string} parent   - the optional parent id
 * @returns {Promise} Elasticsearch response
 */
async function genericRecordUpdate(esClient, id, doc, index, type, parent) {
  if (!doc) throw new Error('Nothing to update. Make sure doc argument has a value');

  const body = cloneDeep(doc);
  body.timestamp = Date.now();

  const params = {
    body,
    id,
    index,
    type,
    refresh: inTestMode()
  };

  if (parent) params.parent = parent;

  // adding or replacing record to ES
  const actualEsClient = esClient || (await Search.es());
  return actualEsClient.index(params);
}

/**
 * Indexes a step function message to Elastic Search. The message must
 * comply with the cumulus message protocol
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {Object} payload  - Cumulus Step Function message
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: execution)
 * @returns {Promise} elasticsearch update response
 */
function indexExecution(esClient, payload, index = defaultIndexAlias, type = 'execution') {
  return genericRecordUpdate(esClient, payload.arn, payload, index, type);
}

/**
 * Extracts PDR info from a StepFunction message and save it to DynamoDB
 *
 * @param  {Object} payload  - Cumulus Step Function message
 * @returns {Promise<Object>} Elasticsearch response
 */
function pdr(payload) {
  const p = new Pdr();
  return p.createPdrFromSns(payload);
}

/**
 * Indexes the collection on ElasticSearch
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {Object} meta     - the collection record
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: collection)
 * @returns {Promise} Elasticsearch response
 */
function indexCollection(esClient, meta, index = defaultIndexAlias, type = 'collection') {
  const collectionId = constructCollectionId(meta.name, meta.version);
  return genericRecordUpdate(esClient, collectionId, meta, index, type);
}

/**
 * Indexes the provider type on ElasticSearch
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {Object} payload  - the provider record
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: provider)
 * @returns {Promise} Elasticsearch response
 */
function indexProvider(esClient, payload, index = defaultIndexAlias, type = 'provider') {
  return genericRecordUpdate(esClient, payload.id, payload, index, type);
}

/**
 * Indexes the rule type on ElasticSearch
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {Object} payload  - the Rule record
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: rule)
 * @returns {Promise} Elasticsearch response
 */
function indexRule(esClient, payload, index = defaultIndexAlias, type = 'rule') {
  return genericRecordUpdate(esClient, payload.name, payload, index, type);
}

/**
 * Indexes the granule type on ElasticSearch
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {Object} payload  - Cumulus Step Function message
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: granule)
 * @returns {Promise} Elasticsearch response
 */
async function indexGranule(esClient, payload, index = defaultIndexAlias, type = 'granule') {
  // If the granule exists in 'deletedgranule', delete it first before inserting the granule
  // into ES.  Ignore 404 error, so the deletion still succeeds if the record doesn't exist.
  const delGranParams = {
    index,
    type: 'deletedgranule',
    id: payload.granuleId,
    parent: payload.collectionId,
    refresh: inTestMode(),
    ignore: [404]
  };
  await esClient.delete(delGranParams);

  return genericRecordUpdate(
    esClient,
    payload.granuleId,
    payload,
    index,
    type,
    payload.collectionId
  );
}

/**
 * Indexes the pdr type on ElasticSearch
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {Object} payload  - Cumulus Step Function message
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: pdr)
 * @returns {Promise} Elasticsearch response
 */
async function indexPdr(esClient, payload, index = defaultIndexAlias, type = 'pdr') {
  return genericRecordUpdate(
    esClient,
    payload.pdrName,
    payload,
    index,
    type
  );
}

/**
 * Extracts granule info from a stepFunction message and save it to DynamoDB
 *
 * @param  {Object} payload  - Cumulus Step Function message
 * @returns {Promise<Array>} list of created records
 */
function granule(payload) {
  const g = new Granule();
  return g.createGranulesFromSns(payload);
}

/**
 * delete a record from ElasticSearch
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {string} id       - id of the Elasticsearch record
 * @param  {string} type     - Elasticsearch type (default: execution)
 * @param  {strint} parent   - id of the parent (optional)
 * @param  {string} index    - Elasticsearch index (default: cumulus)
 * @returns {Promise} elasticsearch delete response
 */
async function deleteRecord(esClient, id, type, parent, index = defaultIndexAlias) {
  const params = {
    index,
    type,
    id,
    refresh: inTestMode()
  };

  if (parent) params.parent = parent;

  const actualEsClient = esClient || (await Search.es());

  const getResponse = await actualEsClient.get(params);
  const deleteResponse = await actualEsClient.delete(params);

  if (type === 'granule' && getResponse.found) {
    const doc = getResponse._source;
    doc.timestamp = Date.now();
    doc.deletedAt = Date.now();

    // When a 'granule' record is deleted, the record is added to 'deletedgranule'
    // type for EMS report purpose.
    await genericRecordUpdate(
      actualEsClient,
      doc.granuleId,
      doc,
      index,
      'deletedgranule',
      parent
    );
  }
  return deleteResponse;
}

/**
 * start the re-ingest of a given granule object
 *
 * @param  {Object} g - the granule object
 * @returns {Promise} an object showing the start of the re-ingest
 */
async function reingest(g) {
  const gObj = new Granule();
  return gObj.reingest(g);
}

const isCompletedExecutionMessage = (cumulusMessage) =>
  ['failed', 'completed'].includes(cumulusMessage.meta.status);

const buildExecutionRecord = async (executionModel, cumulusMessage) => {
  const executionRecord = isCompletedExecutionMessage(cumulusMessage)
    ? await executionModel.buildUpdatedExecutionRecordFromCumulusMessage(cumulusMessage)
    : executionModel.buildNewExecutionRecordFromCumulusMessage(cumulusMessage);

  executionModel.validate(executionRecord);

  return executionRecord;
};

const buildGranuleRecords = async (granuleModel, cumulusMessage) => {
  const granuleRecords = await granuleModel.buildGranuleRecordsFromCumulusMessage(cumulusMessage);
  granuleRecords.forEach((g) => granuleModel.validate(g));
  return granuleRecords;
};

const buildPdrRecord = (pdrModel, cumulusMessage) => {
  const pdrRecord = pdrModel.buildPdrRecordFromCumulusMessage(cumulusMessage);
  pdrModel.validate(pdrRecord);
  return pdrRecord;
};

const buildTransactPut = curry(
  (TableName, record) => {
    if (isNil(record)) return null;

    return {
      Put: {
        TableName,
        Item: DynamoDB.recordToDynamoItem(record)
      }
    };
  }
);

/**
 * processes the incoming cumulus message and pass it through a number
 * of indexers
 *
 * @param  {Object} event - incoming cumulus message
 * @returns {Promise} object with response from the three indexer
 */
async function handlePayload(event) {
  const executionModel = new Execution();
  const granuleModel = new Granule();
  const pdrModel = new Pdr();

  const payload = event.EventSource === 'aws:sns'
    ? JSON.parse(event.Sns.Message)
    : event;

  const executionRecord = await buildExecutionRecord(executionModel, payload);
  const pdrRecord = buildPdrRecord(pdrModel, payload);
  const granuleRecords = await buildGranuleRecords(granuleModel, payload);

  const recordsCount = flatten([executionRecord, granuleRecords, pdrRecord]).length;

  if (recordsCount > 10 || inTestMode()) {
    if (executionRecord) await executionModel.create(executionRecord);
    if (pdrRecord) await pdrModel.create(pdrRecord);
    await granuleModel.create(granuleRecords);
  }
  else if (recordsCount > 0) {
    const TransactItems = flatten([
      buildTransactPut(executionModel.tableName, executionRecord),
      buildTransactPut(pdrModel.tableName, pdrRecord),
      granuleRecords.map(buildTransactPut(granuleModel.tableName))
    ]).filter(isNotNil);

    await dynamodb().transactWriteItems({ TransactItems }).promise();
  }

  return {
    sf: executionRecord,
    pdr: pdrRecord,
    granule: isEmpty(granuleRecords) ? null : granuleRecords
  };
}

/**
 * processes the incoming log events coming from AWS
 * CloudWatch
 *
 * @param  {Object} event - incoming message from CloudWatch
 * @param  {Object} context - aws lambda context object
 * @param  {function} cb - aws lambda callback function
 */
function logHandler(event, context, cb) {
  log.debug(event);
  const payload = Buffer.from(event.awslogs.data, 'base64');
  zlib.gunzip(payload, (e, r) => {
    try {
      const logs = JSON.parse(r.toString());
      log.debug(logs);
      return indexLog(undefined, logs.logEvents)
        .then((s) => cb(null, s))
        .catch(cb);
    }
    catch (err) {
      log.error(e);
      return cb(null);
    }
  });
}

/**
 * Lambda function handler for sns2elasticsearch
 *
 * @param  {Object} event - incoming message sns
 * @returns {Promise} undefined
 */
async function handler(event) {
  // we can handle both incoming message from SNS as well as direct payload
  const jobs = event.Records
    ? event.Records.map(handlePayload)
    : [handlePayload(event)];

  const result = await Promise.all(jobs);
  log.info(`Updated ${result.length} es records`);

  return result;
}

module.exports = {
  constructCollectionId,
  deconstructCollectionId,
  handler,
  logHandler,
  indexCollection,
  indexLog,
  indexProvider,
  indexRule,
  indexGranule,
  indexPdr,
  indexExecution,
  handlePayload,
  partialRecordUpdate,
  deleteRecord,
  reingest,
  granule,
  pdr
};
