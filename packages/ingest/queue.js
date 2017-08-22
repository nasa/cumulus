'use strict';

const get = require('lodash.get');
const { SQS, S3, getExecutionArn } = require('./aws');

async function getTemplate(event) {
  const templates = get(event, 'resources.templates');
  const next = get(event, 'ingest_meta.config.next', 'ParsePdr');

  const parsed = S3.parseS3Uri(templates[next]);
  const data = await S3.get(parsed.Bucket, parsed.Key);
  const message = JSON.parse(data.Body);
  message.provider = event.provider;
  message.collection = event.collection;
  message.meta = event.meta;

  return message;
}

async function queuePdr(event, pdr) {
  const queueUrl = get(event, 'resources.queues.startSF');
  const message = await getTemplate(event);

  message.payload = { pdr };
  message.ingest_meta.execution_name = `${pdr.name}__PDR__${Date.now()}`;

  return SQS.sendMessage(queueUrl, message);
}

async function queueGranule(event, granule) {
  const queueUrl = get(event, 'resources.queues.startSF');
  const collectionId = get(event, 'collection.id');
  const pdr = get(event, 'payload.pdr', null);
  const message = await getTemplate(event);

  // if size is larger than 450mb skip
  for (const f of granule.files) {
    if (f.fileSize > 450000000) {
      return false;
    }
  }

  message.payload = {
    granules: [{
      granuleId: granule.granuleId,
      files: granule.files
    }]
  };

  if (pdr) {
    message.payload.pdr = pdr;
  }

  const name = `${collectionId}__GRANULE__${granule.granuleId}__${Date.now()}`;
  const arn = getExecutionArn(message.ingest_meta.state_machine, name);

  message.ingest_meta.execution_name = name;
  await SQS.sendMessage(queueUrl, message);
  return arn;
}

module.exports.queuePdr = queuePdr;
module.exports.queueGranule = queueGranule;
