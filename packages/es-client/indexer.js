// @ts-check

/* functions for transforming and indexing Cumulus Payloads
 * in Elasticsearch. These functions are specifically designed
 * to transform data for use in cumulus api
 *
 * The module accepts the following kinds of workflows (state machines):
 * - ParsePdrs
 * - IngestGranules
 * - StateMachine (if a payload doesn't belong to previous ones)
 */

'use strict';

const cloneDeep = require('lodash/cloneDeep');
const isEqual = require('lodash/isEqual');

const Logger = require('@cumulus/logger');
const { inTestMode } = require('@cumulus/common/test-utils');
const { IndexExistsError, ValidationError } = require('@cumulus/errors');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { removeNilProperties } = require('@cumulus/common/util');

const { Search, defaultIndexAlias } = require('./search');
const mappings = require('./config/mappings.json');

const logger = new Logger({ sender: '@cumulus/es-client/indexer' });

async function createIndex(esClient, indexName) {
  const indexExists = await esClient.indices.exists({ index: indexName })
    .then((response) => response.body);

  if (indexExists) {
    throw new IndexExistsError(`Index ${indexName} exists and cannot be created.`);
  }

  await esClient.indices.create({
    index: indexName,
    body: {
      mappings,
      settings: {
        index: {
          number_of_shards: process.env.ES_INDEX_SHARDS || 1,
        },
      },
    },
  });

  logger.info(`Created esIndex ${indexName}`);
}

/**
 * Indexes a given record to the specified Elasticsearch index and type
 *
 * @param  {Object} esClient - Elasticsearch Connection object
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
    refresh: inTestMode(),
  };

  if (parent) params.parent = parent;

  // adding or replacing record to ES
  const actualEsClient = esClient || (await Search.es());
  let indexResponse;
  try {
    indexResponse = await actualEsClient.index(params);
  } catch (error) {
    logger.error(`Error thrown on index ${JSON.stringify(error)}`);
    throw error;
  }
  return indexResponse.body;
}

/**
 * Updates a given record for the Elasticsearch index and type
 *
 * @param  {Object} esClient - Elasticsearch Connection object
 * @param  {string} id       - the record id
 * @param  {Object} doc      - the record
 * @param  {string} index    - Elasticsearch index alias
 * @param  {string} type     - Elasticsearch type
 * @returns {Promise} Elasticsearch response
 */
async function updateExistingRecord(esClient, id, doc, index, type) {
  return await esClient.update({
    index,
    type,
    id,
    body: {
      doc: {
        ...doc,
        timestamp: Date.now(),
      },
    },
    refresh: inTestMode(),
  });
}

/**
 * Updates an asyncOperation record in Elasticsearch
 *
 * @param  {Object} esClient - Elasticsearch Connection object
 * @param  {Object} id - Record ID
 * @param  {Object} updates - Document of updates to apply
 * @param  {string} index - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type - Elasticsearch type (default: asyncOperation)
 * @returns {Promise} elasticsearch update response
 */
function updateAsyncOperation(esClient, id, updates, index = defaultIndexAlias, type = 'asyncOperation') {
  return updateExistingRecord(esClient, id, updates, index, type);
}

/**
 * Upsert an execution record in Elasticsearch
 *
 * @param {Object} params
 * @param {Object} params.esClient - Elasticsearch Connection object
 * @param {Object} params.updates - Document of updates to apply
 * @param {string} params.index - Elasticsearch index alias (default defined in search.js)
 * @param {string} params.type - Elasticsearch type (default: execution)
 * @param {string} [params.refresh] - whether to refresh the index on update or not
 * @returns {Promise} elasticsearch update response
 */
async function upsertExecution({
  esClient,
  updates,
  index = defaultIndexAlias,
  type = 'execution',
  refresh,
}) {
  const upsertDoc = {
    ...updates,
    timestamp: Date.now(),
  };
  return await esClient.update({
    index,
    type,
    id: upsertDoc.arn,
    body: {
      script: {
        lang: 'painless',
        inline: `
          if (params.doc.status == "running") {
            ctx._source.updatedAt = params.doc.updatedAt;
            ctx._source.timestamp = params.doc.timestamp;
            ctx._source.originalPayload = params.doc.originalPayload;
          } else {
            ctx._source.putAll(params.doc)
          }
        `,
        params: {
          doc: upsertDoc,
        },
      },
      upsert: upsertDoc,
    },
    refresh: refresh !== undefined ? refresh : inTestMode(),
    retry_on_conflict: 3,
  });
}

/**
 * Indexes a step function message to Elastic Search. The message must
 * comply with the cumulus message protocol
 *
 * @param  {Object} esClient - Elasticsearch Connection object
 * @param  {Object} payload  - Cumulus Step Function message
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: execution)
 * @returns {Promise} elasticsearch update response
 */
function indexExecution(esClient, payload, index = defaultIndexAlias, type = 'execution') {
  return genericRecordUpdate(esClient, payload.arn, payload, index, type);
}

/**
 * Indexes the asyncOperation type on Elasticsearch
 *
 * @param  {Object} esClient - Elasticsearch Connection object
 * @param  {Object} payload  - Cumulus Step Function message
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: asyncOperation)
 * @returns {Promise} elasticsearch update response
 */
function indexAsyncOperation(esClient, payload, index = defaultIndexAlias, type = 'asyncOperation') {
  return genericRecordUpdate(esClient, payload.id, payload, index, type);
}

/**
 * Indexes the collection on Elasticsearch
 *
 * @param  {Object} esClient - Elasticsearch Connection object
 * @param  {Object} collection - the collection record
 * @param  {string} index - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type - Elasticsearch type (default: collection)
 * @returns {Promise} Elasticsearch response
 */
function indexCollection(esClient, collection, index = defaultIndexAlias, type = 'collection') {
  const collectionId = constructCollectionId(collection.name, collection.version);
  return genericRecordUpdate(esClient, collectionId, collection, index, type);
}

/**
 * Indexes the provider type on Elasticsearch
 *
 * @param  {Object} esClient - Elasticsearch Connection object
 * @param  {Object} payload  - the provider record
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: provider)
 * @returns {Promise} Elasticsearch response
 */
function indexProvider(esClient, payload, index = defaultIndexAlias, type = 'provider') {
  return genericRecordUpdate(esClient, payload.id, payload, index, type);
}

/**
 * Indexes the reconciliationReport type on Elasticsearch
 *
 * @param  {Object} esClient - Elasticsearch Connection object
 * @param  {Object} payload  - the ReconciliationReport record
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: reconciliationReport)
 * @returns {Promise} Elasticsearch response
 */
function indexReconciliationReport(esClient, payload, index = defaultIndexAlias, type = 'reconciliationReport') {
  return genericRecordUpdate(esClient, payload.name, payload, index, type);
}

/**
 * Indexes the rule type on Elasticsearch
 *
 * @param  {Object} esClient - Elasticsearch Connection object
 * @param  {Object} payload  - the Rule record
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: rule)
 * @returns {Promise} Elasticsearch response
 */

function indexRule(esClient, payload, index = defaultIndexAlias, type = 'rule') {
  return genericRecordUpdate(esClient, payload.name, payload, index, type);
}

/**
 * Indexes the granule type on Elasticsearch
 *
 * @param  {Object} esClient - Elasticsearch Connection object
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
  };
  await esClient.delete(delGranParams, { ignore: [404] });

  return genericRecordUpdate(
    esClient,
    payload.granuleId,
    payload,
    index,
    type,
    payload.collectionId
  );
}

const granuleInvalidNullFields = [
  'granuleId',
  'collectionId',
  'status',
  'updatedAt',
  'execution',
  'createdAt',
];

/**
 * Upserts a granule in Elasticsearch
 *
 * @param {Object} params
 * @param {Object} params.esClient          - Elasticsearch Connection object
 * @param {Object} params.updates           - Updates to make
 * @param {string | undefined} params.index - Elasticsearch index alias
 *                                            (default defined in search.js)
 * @param {string} [params.type]              - Elasticsearch type (default: granule)
 * @param {string} [params.refresh]         - whether to refresh the index on update or not
 * @param {boolean} writeConstraints      - boolean toggle restricting if conditionals should
 *                                          be used to determine write eligibility
 * @returns {Promise} Elasticsearch response
 */
async function upsertGranule({
  esClient,
  updates,
  index = defaultIndexAlias,
  type = 'granule',
  refresh,
}, writeConstraints = true) {
  Object.keys(updates).forEach((key) => {
    if (updates[key] === null && granuleInvalidNullFields.includes(key)) {
      throw new ValidationError(`Attempted DynamoDb write with invalid key ${key} set to null.  Please remove or change this field and retry`);
    }
  });
  // If the granule exists in 'deletedgranule', delete it first before inserting the granule
  // into ES.  Ignore 404 error, so the deletion still succeeds if the record doesn't exist.
  const delGranParams = {
    index,
    type: 'deletedgranule',
    id: updates.granuleId,
    parent: updates.collectionId,
    refresh: inTestMode(),
  };
  await esClient.delete(delGranParams, { ignore: [404] });

  // Remove nils in case there isn't a collision
  const upsertDoc = removeNilProperties(updates);
  let removeString = '';

  // Set field removal for null values
  Object.entries(updates).forEach(([fieldName, value]) => {
    // File removal is a special case as null gets set to []
    if (fieldName === 'files' && isEqual(value, [])) {
      removeString += `ctx._source.remove('${fieldName}'); `;
      delete upsertDoc.files; // Remove files in case this is not a scripted upsert
    }
    if (value === null) {
      removeString += `ctx._source.remove('${fieldName}'); `;
    }
  });

  let inlineDocWriteString = 'ctx._source.putAll(params.doc);';
  if (removeString !== '') {
    inlineDocWriteString += removeString;
  }
  let inline = inlineDocWriteString;

  if (writeConstraints === true) {
    // Because both API write and message write chains use the granule model to store records, in
    // cases where createdAt does not exist on the granule, we assume overwrite protections are
    // undesired behavior via business logic on the message write logic
    inline = `
    if ((ctx._source.createdAt === null || params.doc.createdAt >= ctx._source.createdAt)
      && ((params.doc.status != 'running' && params.doc.status != 'queued') || ((params.doc.status == 'running' || params.doc.status == 'queued') && params.doc.execution != ctx._source.execution))) {
      ${inlineDocWriteString}
    } else {
      ctx.op = 'none';
    }
    `;
    if (!updates.createdAt) {
      inline = `
        if ((params.doc.status != 'running' && params.doc.status != 'queued') || ((params.doc.status == 'running' || params.doc.status == 'queued') && params.doc.execution != ctx._source.execution)) {
          ${inlineDocWriteString}
        } else {
        ctx.op = 'none';
      }
      `;
    }
  }

  return await esClient.update({
    index,
    type,
    id: updates.granuleId,
    parent: updates.collectionId,
    body: {
      script: {
        lang: 'painless',
        inline,
        params: {
          doc: upsertDoc,
        },
      },
      upsert: upsertDoc,
    },
    refresh: refresh !== undefined ? refresh : inTestMode(),
    retry_on_conflict: 3,
  });
}

/**
 * Indexes the pdr type on Elasticsearch
 *
 * @param  {Object} esClient - Elasticsearch Connection object
 * @param  {Object} payload  - Cumulus Step Function message
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: pdr)
 * @returns {Promise} Elasticsearch response
 */
async function indexPdr(esClient, payload, index = defaultIndexAlias, type = 'pdr') {
  return await genericRecordUpdate(
    esClient,
    payload.pdrName,
    payload,
    index,
    type
  );
}

/**
 * Upsert a PDR record in Elasticsearch
 *
 * @param {Object} params
 * @param {Object} params.esClient - Elasticsearch Connection object
 * @param {Object} params.updates - Document to upsert
 * @param {string} params.index - Elasticsearch index alias (default defined in search.js)
 * @param {string} params.type - Elasticsearch type (default: execution)
 * @param {string} [params.refresh] - whether to refresh the index on update or not
 * @returns {Promise} elasticsearch update response
 */
async function upsertPdr({
  esClient,
  updates,
  index = defaultIndexAlias,
  type = 'pdr',
  refresh,
}) {
  const upsertDoc = {
    ...updates,
    timestamp: Date.now(),
  };
  return await esClient.update({
    index,
    type,
    id: upsertDoc.pdrName,
    body: {
      script: {
        lang: 'painless',
        inline: `
          if ((ctx._source.createdAt === null || params.doc.createdAt >= ctx._source.createdAt)
            && (params.doc.execution != ctx._source.execution || params.doc.progress > ctx._source.progress)) {
            ctx._source.putAll(params.doc);
          } else {
            ctx.op = 'none';
          }
        `,
        params: {
          doc: upsertDoc,
        },
      },
      upsert: upsertDoc,
    },
    refresh: refresh !== undefined ? refresh : inTestMode(),
    retry_on_conflict: 3,
  });
}

/**
 * delete a record from Elasticsearch
 *
 * @param  {Object} params
 * @param  {Object} params.esClient - Elasticsearch Connection object
 * @param  {string} params.id       - id of the Elasticsearch record
 * @param  {string} params.type     - Elasticsearch type (default: execution)
 * @param  {strint} params.parent   - id of the parent (optional)
 * @param  {string} params.index    - Elasticsearch index (default: cumulus)
 * @param  {Array}  params.ignore   - Response codes to ignore (optional)
 * @returns {Promise} elasticsearch delete response
 */
async function deleteRecord({
  esClient,
  id,
  type,
  parent,
  index = defaultIndexAlias,
  ignore,
}) {
  const params = {
    index,
    type,
    id,
    refresh: inTestMode(),
  };

  let options = {};

  if (parent) params.parent = parent;
  if (ignore) options = { ignore };

  const actualEsClient = esClient || (await Search.es());
  const deleteResponse = await actualEsClient.delete(params, options);
  return deleteResponse.body;
}

/**
 * Deletes the collection in Elasticsearch
 *
 * @param  {Object} params
 * @param  {Object} params.esClient - Elasticsearch Connection object
 * @param  {string} params.collectionId - the collection ID
 * @param  {string[]} [params.ignore] - Array of response codes to ignore
 * @param  {string} params.index - Elasticsearch index alias (default defined in search.js)
 * @param  {string} params.type - Elasticsearch type (default: collection)
 * @returns {Promise} Elasticsearch response
 */
function deleteCollection({
  esClient,
  collectionId,
  ignore,
  index = defaultIndexAlias,
  type = 'collection',
}) {
  return deleteRecord({
    esClient,
    id: collectionId,
    index,
    type,
    ignore,
  });
}

/**
 * Deletes the provider in Elasticsearch
 *
 * @param  {Object} params
 * @param  {Object} params.esClient - Elasticsearch Connection object
 * @param  {string} params.id - the provider ID
 * @param  {string[]} [params.ignore] - Array of response codes to ignore
 * @param  {string} params.index - Elasticsearch index alias (default defined in search.js)
 * @param  {string} params.type - Elasticsearch type (default: provider)
 * @returns {Promise} Elasticsearch response
 */
function deleteProvider({
  esClient,
  id,
  ignore,
  index = defaultIndexAlias,
  type = 'provider',
}) {
  return deleteRecord({
    esClient,
    id,
    index,
    type,
    ignore,
  });
}

/**
 * Deletes the rule in Elasticsearch
 *
 * @param  {Object} params
 * @param  {Object} params.esClient - Elasticsearch Connection object
 * @param  {string} params.name - the rule name
 * @param  {string[]} [params.ignore] - Array of response codes to ignore
 * @param  {string} params.index - Elasticsearch index alias (default defined in search.js)
 * @param  {string} params.type - Elasticsearch type (default: rule)
 * @returns {Promise} Elasticsearch response
 */
function deleteRule({
  esClient,
  name,
  ignore,
  index = defaultIndexAlias,
  type = 'rule',
}) {
  return deleteRecord({
    esClient,
    id: name,
    index,
    type,
    ignore,
  });
}

/**
 * Deletes the PDR in Elasticsearch
 *
 * @param  {Object} params
 * @param  {Object} params.esClient - Elasticsearch Connection object
 * @param  {string} params.name - the PDR name
 * @param  {string[]} [params.ignore] - Array of response codes to ignore
 * @param  {string} params.index - Elasticsearch index alias (default defined in search.js)
 * @param  {string} params.type - Elasticsearch type (default: PDR)
 * @returns {Promise} Elasticsearch response
 */
function deletePdr({
  esClient,
  name,
  ignore,
  index = defaultIndexAlias,
  type = 'pdr',
}) {
  return deleteRecord({
    esClient,
    id: name,
    index,
    type,
    ignore,
  });
}

/**
 * Deletes the execution in Elasticsearch
 *
 * @param  {Object} params
 * @param  {Object} params.esClient - Elasticsearch Connection object
 * @param  {string} params.arn - execution ARN
 * @param  {string[]} [params.ignore] - Array of response codes to ignore
 * @param  {string} params.index - Elasticsearch index alias (default defined in search.js)
 * @param  {string} params.type - Elasticsearch type (default: execution)
 * @returns {Promise} Elasticsearch response
 */
function deleteExecution({
  esClient,
  arn,
  ignore,
  index = defaultIndexAlias,
  type = 'execution',
}) {
  return deleteRecord({
    esClient,
    id: arn,
    index,
    type,
    ignore,
  });
}

/**
 * Deletes the async operation in Elasticsearch
 *
 * @param {Object} params
 * @param {Object} params.esClient - Elasticsearch Connection object
 * @param {string} params.id - the async operation ID
 * @param {string[]} [params.ignore] - Array of response codes to ignore
 * @param {string} params.index - Elasticsearch index alias (default defined in search.js)
 * @param {string} params.type - Elasticsearch type (default: asyncOperation)
 * @returns {Promise} Elasticsearch response
*/
function deleteAsyncOperation({
  esClient,
  id,
  ignore,
  index = defaultIndexAlias,
  type = 'asyncOperation',
}) {
  return deleteRecord({
    esClient,
    id,
    index,
    type,
    ignore,
  });
}

/**
 * Deletes the reconciliation report from Elasticsearch
 *
 * @param  {Object} params
 * @param  {Object} params.esClient - Elasticsearch Connection object
 * @param  {string} params.name - reconciliation report name
 * @param  {string[]} [params.ignore] - Array of response codes to ignore
 * @param  {string} params.index - Elasticsearch index alias (default defined in search.js)
 * @param  {string} params.type - Elasticsearch type (default: reconciliationReport)
 * @returns {Promise} Elasticsearch response
 */
function deleteReconciliationReport({
  esClient,
  name,
  ignore,
  index = defaultIndexAlias,
  type = 'reconciliationReport',
}) {
  return deleteRecord({
    esClient,
    id: name,
    index,
    type,
    ignore,
  });
}

/**
 * Deletes the granule in Elasticsearch
 *
 * @param  {Object} params
 * @param  {Object} params.esClient - Elasticsearch Connection object
 * @param  {string} params.granuleId - the granule ID
 * @param  {string} params.collectionId - the collection ID
 * @param  {string[]} [params.ignore] - Array of response codes to ignore
 * @param  {string} params.index - Elasticsearch index alias (default defined in search.js)
 * @param  {string} params.type - Elasticsearch type (default: granule)
 * @returns {Promise} Elasticsearch response
 */
async function deleteGranule({
  esClient,
  granuleId,
  collectionId,
  ignore,
  index = defaultIndexAlias,
  type = 'granule',
}) {
  const esGranulesClient = new Search(
    {},
    type,
    index
  );
  const granuleEsRecord = await esGranulesClient.get(granuleId, collectionId);

  // When a 'granule' record is deleted, the record is added to 'deletedgranule' type
  const deletedGranuleDoc = granuleEsRecord;
  delete deletedGranuleDoc._id;
  deletedGranuleDoc.timestamp = Date.now();
  deletedGranuleDoc.deletedAt = Date.now();
  await genericRecordUpdate(
    esClient,
    granuleId,
    deletedGranuleDoc,
    index,
    'deletedgranule',
    collectionId
  );

  return await deleteRecord({
    esClient,
    id: granuleId,
    parent: collectionId,
    index,
    type,
    ignore,
  });
}

module.exports = {
  createIndex,
  indexCollection,
  indexProvider,
  indexReconciliationReport,
  indexRule,
  indexGranule,
  upsertGranule,
  indexPdr,
  upsertPdr,
  indexExecution,
  indexAsyncOperation,
  deleteRecord,
  deleteAsyncOperation,
  updateAsyncOperation,
  upsertExecution,
  deleteCollection,
  deleteProvider,
  deleteRule,
  deletePdr,
  deleteGranule,
  deleteExecution,
  deleteReconciliationReport,
  granuleInvalidNullFields,
};
