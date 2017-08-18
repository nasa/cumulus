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
    arn,
    name,
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

  const stats = {
    total: get(payload, 'payload.granules_queued', 0),
    completed: get(payload, 'payload.granules.completed', 0),
    failed: get(payload, 'payload.granules.failed', 0)
  };

  stats.processing = stats.total - stats.completed - stats.failed;
  const progress = stats.total > 0 ? stats.processing / stats.total : 0;

  const doc = {
    execution: url,
    pdrName: get(payload, 'payload.pdr.name'),
    collection: get(payload, 'collection.id'),
    status: get(payload, 'ingest_meta.status'),
    provider: get(payload, 'provider.id'),
    progress,
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

async function granule(esClient, payload, index = 'cumulus', type = 'granule') {
  const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
  const sfArn = get(payload, 'ingest_meta.state_machine').replace('stateMachine', 'execution');
  const name = get(payload, 'ingest_meta.execution_name');
  const arn = `${sfArn}:${name}`;
  const url = `https://console.aws.amazon.com/states/home?region=${region}` +
              `#/executions/details/${arn}`;
  const collection = get(payload, 'collection');
  const meta = collection.meta || collection;
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
    await esClient.update({
      index,
      type: 'collection',
      id: collectionId,
      body: {
        doc: meta,
        doc_as_upsert: true
      }
    });
  }

  const done = granules.map((g) => {
    if (g.granuleId) {
      const doc = {
        execution: url,
        granuleId: g.granuleId,
        pdrName: get(payload, 'payload.pdr.name'),
        collection: collection.id,
        status: get(payload, 'ingest_meta.status'),
        provider: get(payload, 'provider.id'),
        cmrLink: get(g, 'cmr.link'),
        files: g.files,
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

module.exports = handler;

justLocalRun(() => {
  const a = {};
  handler(a, {}, (e, r) => log.info(e, r));
});
