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

const get = require('lodash.get');
const zlib = require('zlib');
const logger = require('@cumulus/ingest/log');
const { justLocalRun } = require('@cumulus/common/local-helpers');
const { getExecutionArn, getExecutionUrl, invoke } = require('@cumulus/ingest/aws');
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


async function indexStepFunction(esClient, payload, index = 'cumulus', type = 'execution') {
  const name = get(payload, 'ingest_meta.execution_name');
  const arn = getExecutionArn(
    get(payload, 'ingest_meta.state_machine'),
    name
  );
  if (arn) {
    const execution = getExecutionUrl(arn);

    const doc = {
      name,
      arn,
      execution,
      error: get(payload, 'exception', null),
      type: get(payload, 'ingest_meta.workflow_name'),
      collectionId: get(payload, 'collection.id'),
      status: get(payload, 'ingest_meta.status'),
      createdAt: get(payload, 'ingest_meta.createdAt'),
      timestamp: Date.now()
    };

    doc.duration = (doc.timestamp - doc.createdAt) / 1000;

    await esClient.update({
      index,
      type,
      id: doc.arn,
      body: {
        doc,
        doc_as_upsert: true
      }
    });
  }
}

async function pdr(esClient, payload, index = 'cumulus', type = 'pdr') {
  const name = get(payload, 'ingest_meta.execution_name');
  const pdrName = get(payload, 'payload.pdr.name')

  if (pdrName) {
    const arn = getExecutionArn(
      get(payload, 'ingest_meta.state_machine'),
      name
    );
    const execution = getExecutionUrl(arn);

    const collection = get(payload, 'collection.meta');
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
      status: get(payload, 'ingest_meta.status'),
      provider: get(payload, 'provider.id'),
      progress,
      execution,
      PANSent: get(payload, 'payload.pdr.PANSent', false),
      PANmessage: get(payload, 'payload.pdr.PANmessage', 'N/A'),
      stats,
      createdAt: get(payload, 'ingest_meta.createdAt'),
      timestamp: Date.now()
    };

    doc.duration = (doc.timestamp - doc.createdAt) / 1000;

    await esClient.update({
      index,
      type,
      id: doc.pdrName,
      body: {
        doc,
        doc_as_upsert: true
      }
    });
  }
}

async function indexCollection(esClient, meta, index = 'cumulus', type = 'collection') {
  // adding collection record to ES
  const collectionId = `${meta.name}___${meta.version}`;
  await esClient.update({
    index,
    type,
    id: collectionId,
    body: {
      doc: {
        name: meta.name,
        version: meta.version,
        dataType: meta.dataType,
        process: meta.process,
        provider_path: meta.provider_path,
        url_path: meta.url_path,
        granuleId: meta.granuleId,
        granuleIdExtraction: meta.granuleIdExtraction,
        sampleFileName: meta.sampleFileName,
        files: meta.files,
        timestamp: Date.now()
      },
      doc_as_upsert: true
    }
  });
}

async function indexProvider(esClient, payload, index = 'cumulus', type = 'provider') {
  // adding collection record to ES
  await esClient.update({
    index,
    type,
    id: payload.id,
    body: {
      doc: {
        id: payload.id,
        globalConnectionLimit: payload.globalConnectionLimit,
        protocol: payload.protocol,
        host: payload.host,
        port: payload.port,
        timestamp: Date.now()
      },
      doc_as_upsert: true
    }
  });
}

async function indexRule(esClient, payload, index = 'cumulus', type = 'rule') {
  // adding collection record to ES
  await esClient.update({
    index,
    type,
    id: payload.name,
    body: {
      doc: {
        name: payload.name,
        workflow: payload.workflow,
        provider: payload.provider,
        collection: payload.collection,
        meta: payload.meta,
        rule: payload.rule,
        state: payload.state,
        timestamp: Date.now()
      },
      doc_as_upsert: true
    }
  });
}

async function granule(esClient, payload, index = 'cumulus', type = 'granule') {
  const name = get(payload, 'ingest_meta.execution_name');
  const granules = get(payload, 'payload.granules');

  if (granules) {
    const arn = getExecutionArn(
      get(payload, 'ingest_meta.state_machine'),
      name
    );

    if (arn) {
      const execution = getExecutionUrl(arn);

      const collection = get(payload, 'collection');
      const meta = collection.meta || collection;
      const exception = get(payload, 'exception');
      const collectionId = `${meta.name}___${meta.version}`;

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
        await indexCollection(esClient, meta);
      }

      const done = granules.map((g) => {
        if (g.granuleId) {
          const doc = {
            granuleId: g.granuleId,
            pdrName: get(payload, 'payload.pdr.name'),
            collectionId,
            status: get(payload, 'ingest_meta.status'),
            provider: get(payload, 'provider.id'),
            execution,
            cmrLink: get(g, 'cmr.link'),
            files: g.files,
            error: exception,
            createdAt: get(payload, 'ingest_meta.createdAt'),
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
  }
  return false;
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
  const payload = await Rule.buildPayload({
    workflow: 'IngestGranule',
    provider: g.provider,
    collection: {
      name: collection[0],
      version: collection[1]
    },
    meta: { granuleId: g.granuleId },
    payload: {
      granules: [{
        granuleId: g.granuleId,
        files: g.files
      }]
    }
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
