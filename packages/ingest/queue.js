'use strict';

const get = require('lodash.get');
const uuidv4 = require('uuid/v4');
const {
  getS3Object,
  sendSQSMessage,
  parseS3Uri,
  getSfnExecutionByName,
  getGranuleStatus
} = require('@cumulus/common/aws');

/**
  * Create a message from a template stored on S3
  *
  * @param {string} templateUri - S3 uri to the workflow template
  * @param {Object} provider - Cumulus provider object
  * @param {Object} collection - Cumulus collection object
  * @returns {Promise} message object
  **/
async function getTemplate(templateUri, provider, collection) {

  const parsedS3Uri = parseS3Uri(templateUri);
  const data = await getS3Object(parsedS3Uri.Bucket, parsedS3Uri.Key);
  const message = JSON.parse(data.Body);

  message.meta.provider = provider;
  message.meta.collection = collection;

  return message;
}

/**
  * Create a message from a template stored on S3
  *
  * @param {string} queueUrl - The SQS url
  * @param {string} templateUri - S3 uri to the workflow template
  * @param {Object} provider - Cumulus provider object
  * @param {Object} collection - Cumulus collection object
  * @param {Object} pdr - the PDR object
  * @param {string} pdr.name - name of the PDR
  * @returns {Promise} promise returned from SQS.sendMessage()
  **/
async function queuePdr(queueUrl, templateUri, provider, collection, pdr) {
  const message = await getTemplate(templateUri, provider, collection);

  message.payload = { pdr };
  message.cumulus_meta.execution_name = uuidv4();;

  return sendSQSMessage(queueUrl, message);
}

/**

  * Create a message from a template stored on S3
  *
  * @param {object} granule
  * @param {string} templateUri - S3 uri to the workflow template
  * @param {Object} provider - Cumulus provider object
  * @param {Object} collection - Cumulus collection object
  * @param {Object} pdr - the PDR object
  * @param {string} pdr.name - name of the PDR
  * @param {string} stack = the deployment stackname
  * @param {string} bucket - the deployment bucket name
  * @returns {promise} returns a promise that resolves to an array of [status, arn]
  **/
async function queueGranule(
  granule,
  queueUrl,
  templateUri,
  provider,
  collection,
  pdr,
  stack,
  bucket
) {
  const message = await getTemplate(templateUri, provider, collection);

  // check if the granule is already processed
  const status = await getGranuleStatus(granule.granuleId, stack, bucket);

  if (status) {
    return status;
  }

  // if size is larger than 450mb skip
  for (const f of granule.files) {
    if (f.fileSize > 450000000) {
      return { completed: granule.granuleId };
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

  const executionName = uuidv4();
  const arn = getSfnExecutionByName(message.cumulus_meta.state_machine, executionName);

  message.cumulus_meta.execution_name = executionName;
  await sendSQSMessage(queueUrl, message);
  return ['running', arn];
}

module.exports.queuePdr = queuePdr;
module.exports.queueGranule = queueGranule;
