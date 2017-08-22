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
const log = require('@cumulus/common/log');
const { justLocalRun } = require('@cumulus/common/local-helpers');
const { Search } = require('./search');

async function indexStepFunction(esClient, payload, index = 'cumulus', type = 'execution') {
  const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
  const sfArn = get(payload, 'ingest_meta.state_machine').replace('stateMachine', 'execution');
  const name = get(payload, 'ingest_meta.execution_name');
  const arn = `${sfArn}:${name}`;
  const execution = `https://console.aws.amazon.com/states/home?region=${region}` +
              `#/executions/details/${arn}`;

  const doc = {
    name,
    arn,
    execution,
    type: get(payload, 'ingest_meta.workflow_name'),
    collection: get(payload, 'collection.id'),
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

async function pdr(esClient, payload, index = 'cumulus', type = 'pdr') {
  const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
  const sfArn = get(payload, 'ingest_meta.state_machine').replace('stateMachine', 'execution');
  const name = get(payload, 'ingest_meta.execution_name');
  const arn = `${sfArn}:${name}`;
  const url = `https://console.aws.amazon.com/states/home?region=${region}` +
              `#/executions/details/${arn}`;

  const collection = get(payload, 'collection.meta');
  const collectionId = `${collection.name}___${collection.version}`;

  const stats = {
    total: get(payload, 'payload.granules_queued', 0),
    completed: get(payload, 'payload.granules.completed', 0),
    failed: get(payload, 'payload.granules.failed', 0)
  };

  stats.processing = stats.total - stats.completed - stats.failed;
  const progress = stats.total > 0 ? stats.processing / stats.total : 0;

  const doc = {
    pdrName: get(payload, 'payload.pdr.name'),
    collectionId,
    status: get(payload, 'ingest_meta.status'),
    provider: get(payload, 'provider.id'),
    progress,
    execution: url,
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
  const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
  const sfArn = get(payload, 'ingest_meta.state_machine').replace('stateMachine', 'execution');
  const name = get(payload, 'ingest_meta.execution_name');
  const arn = `${sfArn}:${name}`;
  const url = `https://console.aws.amazon.com/states/home?region=${region}` +
              `#/executions/details/${arn}`;
  const collection = get(payload, 'collection');
  const meta = collection.meta || collection;
  const exception = get(payload, 'exception');
  const collectionId = `${meta.name}___${meta.version}`;

  const granules = get(payload, 'payload.granules');

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
        execution: url,
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

async function deleteRecord(esClient, id, type, index = 'cumulus') {
  return esClient.delete({
    index,
    type,
    id
  });
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

  const type = get(payload, 'ingest_meta.workflow_name');
  const esClient = await Search.es();

  await indexStepFunction(esClient, payload);

  if (type === 'ParsePdrs') {
    await pdr(esClient, payload);
  }
  else if (type === 'IngestGranule') {
    await granule(esClient, payload);
  }
}

function handler(event, context, cb) {
  // we can handle both incoming message from SNS as well as direct payload
  log.info(JSON.stringify(event));
  const records = get(event, 'Records');
  const jobs = [];

  if (records) {
    jobs.push(records.map(r => handlePayload(r)));
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
  indexCollection,
  indexProvider,
  indexRule,
  deleteRecord
};

justLocalRun(() => {
  //const a = {};
  //handler(a, {}, (e, r) => log.info(e, r));
});
