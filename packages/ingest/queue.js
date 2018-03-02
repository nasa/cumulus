'use strict';

const uuidv4 = require('uuid/v4');
const {
  getS3Object,
  sendSQSMessage,
  parseS3Uri
} = require('@cumulus/common/aws');

/**
  * Create a message from a template stored on S3
  *
  * @param {string} templateUri - S3 uri to the workflow template
  * @returns {Promise} message object
  **/
async function getMessageFromTemplate(templateUri) {
  const parsedS3Uri = parseS3Uri(templateUri);
  const data = await getS3Object(parsedS3Uri.Bucket, parsedS3Uri.Key);
  return JSON.parse(data.Body);
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
  const message = await getMessageFromTemplate(templateUri, provider, collection);

  message.payload = { pdr };
  message.cumulus_meta.execution_name = uuidv4();

  return sendSQSMessage(queueUrl, message);
}

/**
 * Enqueue a granule to be ingested
 *
 * @param {Object} granule - the granule to be enqueued for ingest
 * @param {string} queueUrl - the SQS queue to add the message to
 * @param {string} granuleIngestMessageTemplateUri - the S3 URI of template for
 * a granule ingest message
 * @param {Object} provider - the provider config to be attached to the message
 * @param {Object} collection - the collection config to be attached to the
 *   message
 * @param {Object} pdr - an optional PDR to be configured in the message payload
 * @returns {Promise} - resolves when the message has been enqueued
 */
async function enqueueGranuleIngestMessage(
  granule,
  queueUrl,
  granuleIngestMessageTemplateUri,
  provider,
  collection,
  pdr
) {
  // Build the message from a template
  const message = await getMessageFromTemplate(granuleIngestMessageTemplateUri);

  message.payload = {
    granules: [{
      granuleId: granule.granuleId,
      files: granule.files
    }]
  };
  if (pdr) message.payload.pdr = pdr;

  message.meta.provider = provider;
  message.meta.collection = collection;

  return sendSQSMessage(queueUrl, message);
}
exports.enqueueGranuleIngestMessage = enqueueGranuleIngestMessage;

module.exports.queuePdr = queuePdr;
