/* eslint-disable no-param-reassign */
/* functions for transforming and indexing Cumulus Payloads
 * in ElasticSearch. These functions are specifically designed
 * to transform data for use in daac-ops-api
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
const logger = require('@cumulus/ingest/log');
const { justLocalRun } = require('@cumulus/common/local-helpers');
const { getExecutionArn, getExecutionUrl, invoke, StepFunction } = require('@cumulus/ingest/aws');
const { Search } = require('./search');
const Rule = require('../models/rules');

const log = logger.child({ file: 'daac-ops-api/es/indexer.js' });

async function indexLog(payloads, index = 'cumulus', type = 'logs') {
  const esClient = await Search.es();
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

async function partialRecordUpdate(esClient, id, type, doc, parent, index = 'cumulus') {
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

  console.log(`Updated ${id}`);
  return esClient.update(params);
}

/**
 * Indexes a step function message to Elastic Search. The message must
 * comply with the cumulus message protocol
 *
 * @param  {object} esClient ElasticSearch Connection object
 * @param  {object} payload  Cumulus Step Function message
 * @param  {string} index    Elasticsearch index (default: cumulus)
 * @param  {string} type     Elasticsearch type (default: execution)
 * @return {Promise} elasticsearch update response
 */
function indexStepFunction(esClient, payload, index = 'cumulus', type = 'execution') {
  const name = get(payload, 'cumulus_meta.execution_name');
  const arn = getExecutionArn(
    get(payload, 'cumulus_meta.state_machine'),
    name
  );
  if (!arn) return Promise.resolve();
  const execution = getExecutionUrl(arn);

  const doc = {
    name,
    arn,
    execution,
    error: get(payload, 'exception', null),
    type: get(payload, 'cumulus_meta.workflow_name'),
    collectionId: get(payload, 'meta.collection.name'),
    status: get(payload, 'meta.status', 'UNKNOWN'),
    createdAt: get(payload, 'cumulus_meta.createdAt'),
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
 * @param  {object} esClient ElasticSearch Connection object
 * @param  {object} payload  Cumulus Step Function message
 * @param  {string} index    Elasticsearch index (default: cumulus)
 * @param  {string} type     Elasticsearch type (default: pdr)
 * @return {Promise} Elasticsearch response
 */
function pdr(esClient, payload, index = 'cumulus', type = 'pdr') {
  const name = get(payload, 'cumulus_meta.execution_name');
  const pdrName = get(payload, 'payload.pdr.name')

  if (!pdrName) return Promise.resolve();

  const arn = getExecutionArn(
    get(payload, 'cumulus_meta.state_machine'),
    name
  );
  const execution = getExecutionUrl(arn);

  const collection = get(payload, 'meta.collection');
  const collectionId = `${collection.name}___${collection.version}`;

  const stats = {
    processing: get(payload, 'payload.running', []).length,
    completed: get(payload, 'payload.completed', []).length,
    failed: get(payload, 'payload.failed', []).length
  };

  stats.total = stats.processing + stats.completed + stats.failed;
  let progress = 0;
  if (stats.processing > 0 && stats.total > 0) {
    progress = stats.processing / stats.total;
  }
  else if (stats.processing === 0 && stats.total > 0) {
    progress = 100;
  }

  const doc = {
    pdrName: get(payload, 'payload.pdr.name'),
    collectionId,
    status: get(payload, 'meta.status'),
    provider: get(payload, 'meta.provider.id'),
    progress,
    execution,
    PANSent: get(payload, 'payload.pdr.PANSent', false),
    PANmessage: get(payload, 'payload.pdr.PANmessage', 'N/A'),
    stats,
    createdAt: get(payload, 'cumulus_meta.createdAt'),
    timestamp: Date.now()
  };

  doc.duration = (doc.timestamp - doc.createdAt) / 1000;

  return esClient.update({
    index,
    type,
    id: doc.pdrName,
    body: {
      doc,
      doc_as_upsert: true
    }
  });
}

async function indexCollection(esClient, meta, index = 'cumulus', type = 'collection') {
  // adding collection record to ES
  const collectionId = `${meta.name}___${meta.version}`;
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
  await esClient.update(params);
}

async function indexProvider(esClient, payload, index = 'cumulus', type = 'provider') {
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
  await esClient.update(params);
}

async function indexRule(esClient, payload, index = 'cumulus', type = 'rule') {
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
  await esClient.update(params);
}


/**
 * Extracts granule info from a stepFunction message and indexs it to
 * Elasticsearch
 * @param  {object} esClient ElasticSearch Connection object
 * @param  {object} payload  Cumulus Step Function message
 * @param  {string} index    Elasticsearch index (default: cumulus)
 * @param  {string} type     Elasticsearch type (default: granule)
 * @return {Promise} Elasticsearch response
 */
async function granule(esClient, payload, index = 'cumulus', type = 'granule') {
  const name = get(payload, 'cumulus_meta.execution_name');
  const granules = get(payload, 'payload.granules');

  if (!granules) return;

  const arn = getExecutionArn(
    get(payload, 'cumulus_meta.state_machine'),
    name
  );

  if (arn) return;

  const execution = getExecutionUrl(arn);

  const collection = get(payload, 'meta.collection');
  const exception = get(payload, 'exception');
  const collectionId = `${collection.name}___${collection.version}`;

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

  const done = granules.map((g) => {
    if (g.granuleId) {
      const doc = {
        granuleId: g.granuleId,
        pdrName: get(payload, 'payload.pdr.name'),
        collectionId,
        status: get(payload, 'meta.status'),
        provider: get(payload, 'meta.provider.id'),
        execution,
        cmrLink: get(g, 'cmr.link'),
        files: g.files,
        error: exception,
        createdAt: get(payload, 'cumulus_meta.createdAt'),
        timestamp: Date.now()
      };

      doc.published = get(g, 'cmr.link', false);
      doc.duration = (doc.timestamp - doc.createdAt) / 1000;

      return esClient.update({
        index,
        type,
        id: doc.granuleId,
        parent: collectionId,
        body: {
          doc,
          doc_as_upsert: true
        }
      });
    }
    return false;
  });

  return Promise.all(done);
}

async function deleteRecord(esClient, id, type, parent, index = 'cumulus') {
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

  return esClient.delete(params);
}

async function reingest(g) {
  const collection = g.collectionId.split('___');

  // get the payload of the original execution
  const status = await StepFunction.getExecutionStatus(path.basename(g.execution));
  const originalMessage = JSON.parse(status.execution.input);

  const payload = await Rule.buildPayload({
    workflow: 'IngestGranule',
    provider: g.provider,
    collection: {
      name: collection[0],
      version: collection[1]
    },
    meta: { granuleId: g.granuleId },
    payload: originalMessage.payload
  });

  await partialRecordUpdate(
    null,
    g.granuleId,
    'granule',
    { status: 'running' },
    g.collectionId
  );
  await invoke(process.env.invoke, payload);
  return {
    granuleId: g.granuleId,
    action: 'reingest',
    status: 'SUCCESS'
  };
}

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

  await indexStepFunction(esClient, payload);
  await pdr(esClient, payload);
  await granule(esClient, payload);
}

function logHandler(event, context, cb) {
  log.debug(event);
  const payload = new Buffer(event.awslogs.data, 'base64');
  zlib.gunzip(payload, (e, r) => {
    try {
      const logs = JSON.parse(r.toString());
      log.debug(logs);
      return indexLog(logs.logEvents)
        .then(s => cb(null, s))
        .catch(err => cb(err));
    }
    catch (err) {
      log.error(e);
      return cb(null);
    }
  });
}

function handler(event, context, cb) {
  // we can handle both incoming message from SNS as well as direct payload
  log.debug(JSON.stringify(event));
  const records = get(event, 'Records');
  let jobs = [];

  if (records) {
    jobs = records.map(r => handlePayload(r));
  }
  else {
    jobs.push(handlePayload(event));
  }

  Promise.all(jobs).then(r => {
    log.info(`Updated ${r.length} es records`);
    cb(null, r);
  }).catch(e => cb(e));
}

module.exports = {
  handler,
  logHandler,
  indexCollection,
  indexProvider,
  indexRule,
  handlePayload,
  partialRecordUpdate,
  deleteRecord,
  reingest
};

justLocalRun(() => {
  //const a = {};
  //handler(a, {}, (e, r) => log.info(e, r));
});
