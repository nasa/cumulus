'use strict';

const get = require('lodash.get');

const {
  s3,
  getS3Object,
  sendSQSMessage,
  parseS3Uri,
  getSfnExecutionByName,
  getGranuleStatus
} = require('@cumulus/common/aws');

/**
* Create a message from a template stored on S3
* @param {object} event
* @param {object} event.config
* @param {array} event.config.templates
* @param {object} event.config.cumulus_meta
* @param {object} event.config.cumulus_meta.config
* @param {string} event.config.cumulus_meta.config.next name of the next function in the workflow
* @returns {object} message object
**/
async function getTemplate(event) {
  const config = event.config;
  const templates = get(config, 'templates');
  const nextTask = get(config, 'cumulus_meta.config.next', 'ParsePdr');

  const parsedS3Uri = parseS3Uri(templates[nextTask]);
  const data = await getS3Object(parsedS3Uri.Bucket, parsedS3Uri.Key);
  const message = JSON.parse(data.Body);

  message.provider = config.provider;
  message.collection = config.collection;
  message.meta = config.meta;

  return message;
}

/**
* Create a message from a template stored on S3
* @param {object} event
* @param {object} event.config
* @param {object} event.config.queues
* @param {string} event.config.queues.startSF
* @param {object} pdr
* @param {string} pdr.name
* @returns {promise} promise returned from SQS.sendMessage()
**/
async function queuePdr(event, pdr) {
  const queueUrl = event.config.queues.startSF;
  const message = await getTemplate(event);

  message.input = { pdr };
  message.cumulus_meta.execution_name = `${pdr.name}__PDR__${Date.now()}`;

  return sendSQSMessage(queueUrl, message);
}

/**
* Create a message from a template stored on S3
* @param {object} event
* @param {object} event.config
* @param {object} event.config.queues
* @param {string} event.config.queues.startSF
* @param {object} pdr
* @param {string} pdr.name
* @returns {promise} returns a promise that resolves to an array of [status, arn]
**/
async function queueGranule(event, granule) {
  const queueUrl = event.config.queues.startSF;
  const collectionId = event.config.collection.name;
  const pdr = event.input.pdr;

  const message = await getTemplate(event);

  // check if the granule is already processed
  const status = await getGranuleStatus(granule.granuleId, event.config);

  if (status) {
    return status;
  }

  // if size is larger than 450mb skip
  for (const f of granule.files) {
    if (f.fileSize > 450000000) {
      return { completed: granule.granuleId };
    }
  }

  if (!message.meta) message.meta = {};
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
  const arn = getSfnExecutionByName(message.cumulus_meta.state_machine, name);

  message.cumulus_meta.execution_name = name;
  await sendSQSMessage(queueUrl, message);
  return ['running', arn];
}

module.exports.queuePdr = queuePdr;
module.exports.queueGranule = queueGranule;
