'use strict';

const get = require('lodash.get');
const aws = require('./aws');

async function getTemplate(event) {
  const templates = get(event, 'resources.templates');
  const next = get(event, 'ingest_meta.config.next', 'ParsePdr');

  const parsed = aws.S3.parseS3Uri(templates[next]);
  const data = await aws.S3.get(parsed.Bucket, parsed.Key);
  const message = JSON.parse(data.Body);
  message.provider = event.provider;
  message.collection = event.collection;
  message.meta = event.meta;

  return message;
}

async function queuePdr(event, pdr) {
  const queueUrl = get(event, 'resources.queues.startSF');
  const message = await getTemplate(event);

  message.payload = pdr;
  message.ingest_meta.execution_name = `${pdr.pdrName}__PDR__${Date.now()}`;

  return aws.SQS.sendMessage(queueUrl, message);
}

async function queueGranule(event, granule) {
  const queueUrl = get(event, 'resources.queues.startSF');
  const collectionId = get(event, 'collection.id');
  const message = await getTemplate(event);

  message.meta.pdrName = event.payload.pdrName;

  message.payload = {
    granules: [{
      granuleId: granule.granuleId,
      files: granule.files
    }]
  };

  const name = `${collectionId}__GRANULE__${granule.granuleId}__${Date.now()}`;

  message.ingest_meta.execution_name = name;
  return aws.SQS.sendMessage(queueUrl, message);
}

module.exports.queuePdr = queuePdr;
module.exports.queueGranule = queueGranule;
