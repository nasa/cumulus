/* eslint-disable no-param-reassign */
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

const path = require('path');
const get = require('lodash.get');
const zlib = require('zlib');
const log = require('@cumulus/common/log');
const { justLocalRun } = require('@cumulus/common/local-helpers');
const { Search, defaultIndexAlias } = require('./search');
const Rule = require('../models/rules');
const uniqBy = require('lodash.uniqby');
const cmrjs = require('@cumulus/cmrjs');
const {
  getExecutionArn,
  getExecutionUrl,
  invoke,
  StepFunction
} = require('@cumulus/ingest/aws');

/**
 * Returns the collectionId used in elasticsearch
 * which is a combination of collection name and version
 *
 * @param {string} name - collection name
 * @param {string} version - collection version
 * @returns {string} collectionId
 */
function constructCollectionId(name, version) {
  return `${name}___${version}`;
}

/**
 * Returns the name and version of a collection based on
 * the collectionId used in elasticsearch indexing
 *
 * @param {string} collectionId - collectionId used in elasticsearch index
 * @returns {Object} name and version as object
 */
function deconstructCollectionId(collectionId) {
  const [name, version] = collectionId.split('___');
  return {
    name,
    version
  };
}

/**
 * Ensures that the exception is returned as an object
 *
 * @param {*} exception - the exception
 * @returns {string} an stringified exception
 */
function parseException(exception) {
  // null is considered object
  if (exception === null) {
    return {};
  }

  if (typeof exception !== 'object') {
    const converted = JSON.stringify(exception);
    if (converted === 'undefined') {
      return {};
    }
    exception = { Error: 'Unknown Error', Cause: converted };
  }
  return exception;
}

/**
 * Extracts granule info from a stepFunction message and indexes it to
 * an ElasticSearch
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {Array} payloads  - an array of log payloads
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: granule)
 * @returns {Promise} Elasticsearch response
 */
async function indexLog(esClient, payloads, index = defaultIndexAlias, type = 'logs') {
  if (!esClient) {
    esClient = await Search.es();
  }
  const body = [];

  payloads.forEach((p) => {
    body.push({ index: { _index: index, _type: type, _id: p.id } });
    let record;
    try {
      record = JSON.parse(p.message);
      record.timestamp = record.time;
      delete record.time;
    }
    catch (e) {
      record = {
        msg: p.message,
        timestamp: p.timestamp,
        level: 30,
        pid: 1,
        name: 'cumulus'
      };
    }
    body.push(record);
  });

  return esClient.bulk({ body: body });
}

/**
 * Partially updates an existing ElasticSearch record
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {string} id       - id of the Elasticsearch record
 * @param  {string} type     - Elasticsearch type (default: execution)
 * @param  {Object} doc      - Partial updated document
 * @param  {strint} parent   - id of the parent (optional)
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @returns {Promise} elasticsearch update response
 */
async function partialRecordUpdate(esClient, id, type, doc, parent, index = defaultIndexAlias) {
  if (!esClient) {
    esClient = await Search.es();
  }

  if (!doc) {
    throw new Error('Nothing to update. Make sure doc argument has a value');
  }

  doc.timestamp = Date.now();

  const params = {
    index,
    type,
    id,
    body: {
      doc
    }
  };

  if (parent) {
    params.parent = parent;
  }

  return esClient.update(params);
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
function indexStepFunction(esClient, payload, index = defaultIndexAlias, type = 'execution') {
  const name = get(payload, 'cumulus_meta.execution_name');
  const arn = getExecutionArn(
    get(payload, 'cumulus_meta.state_machine'),
    name
  );
  if (!arn) {
    return Promise.reject(new Error('State Machine Arn is missing. Must be included in the cumulus_meta'));
  }

  const execution = getExecutionUrl(arn);

  const doc = {
    name,
    arn,
    execution,
    error: parseException(payload.exception),
    type: get(payload, 'meta.workflow_name'),
    collectionId: get(payload, 'meta.collection.name'),
    status: get(payload, 'meta.status', 'UNKNOWN'),
    createdAt: get(payload, 'cumulus_meta.workflow_start_time'),
    timestamp: Date.now()
  };

  doc.duration = (doc.timestamp - doc.createdAt) / 1000;

  return esClient.update({
    index,
    type,
    id: doc.arn,
    body: {
      doc,
      doc_as_upsert: true
    }
  });
}

/**
 * Extracts PDR info from a StepFunction message and indexes it to ElasticSearch
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {Object} payload  - Cumulus Step Function message
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: pdr)
 * @returns {Promise} Elasticsearch response
 */
function pdr(esClient, payload, index = defaultIndexAlias, type = 'pdr') {
  const name = get(payload, 'cumulus_meta.execution_name');
  const pdrObj = get(payload, 'payload.pdr', get(payload, 'meta.pdr'));
  const pdrName = get(pdrObj, 'name');

  if (!pdrName) return Promise.resolve();

  const arn = getExecutionArn(
    get(payload, 'cumulus_meta.state_machine'),
    name
  );
  const execution = getExecutionUrl(arn);

  const collection = get(payload, 'meta.collection');
  const collectionId = constructCollectionId(collection.name, collection.version);

  const stats = {
    processing: get(payload, 'payload.running', []).length,
    completed: get(payload, 'payload.completed', []).length,
    failed: get(payload, 'payload.failed', []).length
  };

  stats.total = stats.processing + stats.completed + stats.failed;
  let progress = 0;
  if (stats.processing > 0 && stats.total > 0) {
    progress = ((stats.total - stats.processing) / stats.total) * 100;
  }
  else if (stats.processing === 0 && stats.total > 0) {
    progress = 100;
  }

  const doc = {
    pdrName,
    collectionId,
    status: get(payload, 'meta.status'),
    provider: get(payload, 'meta.provider.id'),
    progress,
    execution,
    PANSent: get(pdrObj, 'PANSent', false),
    PANmessage: get(pdrObj, 'PANmessage', 'N/A'),
    stats,
    createdAt: get(payload, 'cumulus_meta.workflow_start_time'),
    timestamp: Date.now()
  };

  doc.duration = (doc.timestamp - doc.createdAt) / 1000;

  return esClient.update({
    index,
    type,
    id: pdrName,
    body: {
      doc,
      doc_as_upsert: true
    }
  });
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
  // adding collection record to ES
  const collectionId = constructCollectionId(meta.name, meta.version);
  const params = {
    index,
    type,
    id: collectionId,
    body: {
      doc: meta,
      doc_as_upsert: true
    }
  };

  params.body.doc.timestamp = Date.now();
  return esClient.update(params);
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
  const params = {
    index,
    type,
    id: payload.id,
    body: {
      doc: payload,
      doc_as_upsert: true
    }
  };
  params.body.doc.timestamp = Date.now();

  // adding collection record to ES
  return esClient.update(params);
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
  const params = {
    index,
    type,
    id: payload.name,
    body: {
      doc: payload,
      doc_as_upsert: true
    }
  };
  params.body.doc.timestamp = Date.now();

  // adding collection record to ES
  return esClient.update(params);
}

/**
 * Calculate granule product volume, which is the sum of the file
 * sizes in bytes
 *
 * @param {Array<Object>} granuleFiles - array of granule files
 * @returns {Integer} - sum of granule file sizes in bytes
 */
function getGranuleProductVolume(granuleFiles) {
  const fileSizes = granuleFiles.map((file) => file.fileSize)
    .filter((size) => size);

  return fileSizes.reduce((a, b) => a + b);
}

/**
 * Extract a date from the payload and return it in string format
 *
 * @param {Object} payload - payload object
 * @param {string} dateField - date field to extract
 * @returns {string} - date field in string format, null if the
 * field does not exist in the payload
 */
function extractDate(payload, dateField) {
  const dateMs = get(payload, dateField);

  if (dateMs) {
    const date = new Date(dateMs);
    return date.toISOString();
  }

  return null;
}

/**
 * Extracts granule info from a stepFunction message and indexes it to
 * an ElasticSearch
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {Object} payload  - Cumulus Step Function message
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: granule)
 * @returns {Promise} Elasticsearch response
 */
async function granule(esClient, payload, index = defaultIndexAlias, type = 'granule') {
  const name = get(payload, 'cumulus_meta.execution_name');
  const granules = get(payload, 'payload.granules', get(payload, 'meta.input_granules'));

  if (!granules) return Promise.resolve();

  const arn = getExecutionArn(
    get(payload, 'cumulus_meta.state_machine'),
    name
  );

  if (!arn) return Promise.resolve();

  const execution = getExecutionUrl(arn);

  const collection = get(payload, 'meta.collection');
  const exception = parseException(payload.exception);

  const collectionId = constructCollectionId(collection.name, collection.version);

  // make sure collection is added
  try {
    await esClient.get({
      index,
      type: 'collection',
      id: collectionId
    });
  }
  catch (e) {
    // adding collection record to ES
    await indexCollection(esClient, collection);
  }

  const done = granules.map(async (g) => {
    if (g.granuleId) {
      const doc = {
        granuleId: g.granuleId,
        pdrName: get(payload, 'meta.pdr.name'),
        collectionId,
        status: get(payload, 'meta.status'),
        provider: get(payload, 'meta.provider.id'),
        execution,
        cmrLink: get(g, 'cmrLink'),
        files: uniqBy(g.files, 'filename'),
        error: exception,
        createdAt: get(payload, 'cumulus_meta.workflow_start_time'),
        timestamp: Date.now(),
        productVolume: getGranuleProductVolume(g.files),
        timeToPreprocess: get(payload, 'meta.sync_granule_duration') / 1000,
        timeToArchive: get(payload, 'meta.post_to_cmr_duration') / 1000,
        processingStartDateTime: extractDate(payload, 'meta.sync_granule_end_time'),
        processingEndDateTime: extractDate(payload, 'meta.post_to_cmr_start_time')
      };

      doc.published = get(g, 'published', false);
      // Duration is also used as timeToXfer for the EMS report
      doc.duration = (doc.timestamp - doc.createdAt) / 1000;

      if (g.cmrLink) {
        const metadata = await cmrjs.getMetadata(g.cmrLink);
        doc.beginningDateTime = metadata.time_start;
        doc.endingDateTime = metadata.time_end;
        doc.lastUpdateDateTime = metadata.updated;

        const fullMetadata = await cmrjs.getFullMetadata(g.cmrLink);
        if (fullMetadata && fullMetadata.DataGranule) {
          doc.productionDateTime = fullMetadata.DataGranule.ProductionDateTime;
        }
      }

      // If the granule exists in 'deletedgranule', delete it first before inserting the granule
      // into ES.  Ignore 404 error, so the deletion still succeeds if the record doesn't exist.
      const delGranParams = {
        index,
        type: 'deletedgranule',
        id: doc.granuleId,
        parent: collectionId,
        ignore: [404]
      };
      return esClient.delete(delGranParams)
        .then(() => esClient.update({
          index,
          type,
          id: doc.granuleId,
          parent: collectionId,
          body: {
            doc,
            doc_as_upsert: true
          }
        }));
    }
    return Promise.resolve();
  });

  return Promise.all(done);
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
  if (!esClient) {
    esClient = await Search.es();
  }
  const params = {
    index,
    type,
    id
  };

  if (parent) {
    params.parent = parent;
  }
  const result = await esClient.get(params);
  return esClient.delete(params)
    .then(async (response) => {
      if (type === 'granule' && result.found) {
        const doc = result._source;
        doc.timestamp = Date.now();
        doc.deletedAt = Date.now();

        // When a 'granule' record is deleted, the record is added to 'deletedgranule'
        // type for EMS report purpose.
        await esClient.update({
          index,
          type: 'deletedgranule',
          id: doc.granuleId,
          parent: parent,
          body: {
            doc,
            doc_as_upsert: true
          }
        });
      }
      return response;
    });
}

/**
 * start the re-ingest of a given granule object
 *
 * @param  {Object} g - the granule object
 * @param  {string} index - cumulus index alias name (optional)
 * @returns {Promise} an object show the start of the re-ingest
 */
async function reingest(g, index) {
  const { name, version } = deconstructCollectionId(g.collectionId);

  // get the payload of the original execution
  const status = await StepFunction.getExecutionStatus(path.basename(g.execution));
  const originalMessage = JSON.parse(status.execution.input);

  const payload = await Rule.buildPayload({
    workflow: 'IngestGranule',
    provider: g.provider,
    collection: {
      name,
      version
    },
    meta: originalMessage.meta,
    payload: originalMessage.payload
  });

  await partialRecordUpdate(
    null,
    g.granuleId,
    'granule',
    { status: 'running' },
    g.collectionId,
    index
  );
  await invoke(process.env.invoke, payload);
  return {
    granuleId: g.granuleId,
    action: 'reingest',
    status: 'SUCCESS'
  };
}

/**
 * processes the incoming cumulus message and pass it through a number
 * of indexers
 *
 * @param  {Object} event - incoming cumulus message
 * @returns {Promise} object with response from the three indexer
 */
async function handlePayload(event) {
  let payload;
  const source = get(event, 'EventSource');

  if (source === 'aws:sns') {
    payload = get(event, 'Sns.Message');
    payload = JSON.parse(payload);
  }
  else {
    payload = event;
  }

  const esClient = await Search.es();

  // allowing to set index name via env variable
  // to support testing
  const esIndex = process.env.ES_INDEX;

  return {
    sf: await indexStepFunction(esClient, payload, esIndex),
    pdr: await pdr(esClient, payload, esIndex),
    granule: await granule(esClient, payload, esIndex)
  };
}

/**
 * processes the incoming log events coming from AWS
 * CloudWatch
 *
 * @param  {Object} event - incoming message from CloudWatch
 * @param  {Object} context - aws lambda context object
 * @param  {function} cb - aws lambda callback function
 * @returns {Promise} undefined
 */
function logHandler(event, context, cb) {
  log.debug(event);
  const payload = new Buffer(event.awslogs.data, 'base64');
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
 * @param  {Object} context - aws lambda context object
 * @param  {function} cb - aws lambda callback function
 * @returns {Promise} undefined
 */
function handler(event, context, cb) {
  // we can handle both incoming message from SNS as well as direct payload
  log.debug(JSON.stringify(event));
  const records = get(event, 'Records');
  let jobs = [];

  if (records) {
    jobs = records.map(handlePayload);
  }
  else {
    jobs.push(handlePayload(event));
  }

  return Promise.all(jobs)
    .then((r) => {
      log.info(`Updated ${r.length} es records`);
      cb(null, r);
      return r;
    })
    .catch(cb);
}

module.exports = {
  constructCollectionId,
  deconstructCollectionId,
  handler,
  logHandler,
  indexCollection,
  indexProvider,
  indexRule,
  indexStepFunction,
  handlePayload,
  partialRecordUpdate,
  deleteRecord,
  reingest,
  granule,
  pdr
};

justLocalRun(() => {
  // const a = {};
  // handler(a, {}, (e, r) => log.info(e, r));
});
