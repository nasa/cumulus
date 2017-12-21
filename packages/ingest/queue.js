'use strict';

const get = require('lodash.get');
const { SQS, S3, getExecutionArn, StepFunction } = require('./aws');

async function getTemplate(event) {
  const config = get(event, 'config');
  const templates = get(config, 'templates');
  const next = get(config, 'next', 'ParsePdr');

  const parsed = S3.parseS3Uri(templates[next]);
  const data = await S3.get(parsed.Bucket, parsed.Key);
  const message = JSON.parse(data.Body);

  message.provider = get(config, 'provider');
  message.collection = get(config, 'collection');
  message.meta = get(config, 'meta');

  return message;
}

async function queuePdr(event, pdr) {
  const queueUrl = get(event, 'config.queues.startSF');
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

  // check if the granule is already processed
  const status = await StepFunction.getGranuleStatus(granule.granuleId, event);
  if (status) {
    return status;
  }

  // if size is larger than 450mb skip
  for (const f of granule.files) {
    if (f.fileSize > 450000000) {
      return { completed: granule.granuleId };
    }
  }

  message.meta.granuleId = granule.granuleId;
  message.payload = {
    granules: [{
      granuleId: granule.granuleId,
      files: granule.files
    }]
  };

  if (pdr) {
    message.payload.pdr = pdr;
  }

  const name = `${collectionId.substring(0, 15)}__GRANULE__` +
               `${granule.granuleId.substring(0, 16)}__${Date.now()}`;
  const arn = getExecutionArn(message.ingest_meta.state_machine, name);

  message.ingest_meta.execution_name = name;
  await SQS.sendMessage(queueUrl, message);
  return ['running', arn];
}

module.exports.queuePdr = queuePdr;
module.exports.queueGranule = queueGranule;
