'use strict';

const uuidv4 = require('uuid/v4');
const findKey = require('lodash.findkey');

const {
  getS3Object,
  sendSQSMessage,
  parseS3Uri,
  getExecutionArn
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
 * Prepare a SQS message for queueing executions.
 *
 * @param {Object} params
 * @param {Object} params.message - Object for SQS message
 * @param {Object} params.provider - A provider object
 * @param {Object} params.collection - A collection object
 * @param {Object} params.parentExecutionArn - ARN for parent execution
 * @param {Object} params.queueUrl - SQS queue URL
 */
function prepareExecutionQueueMessage({
  message,
  provider,
  collection,
  parentExecutionArn,
  queueUrl
}) {
  message.meta.provider = provider;
  message.meta.collection = collection;
  if (parentExecutionArn) message.cumulus_meta.parentExecutionArn = parentExecutionArn;
  message.cumulus_meta.queueName = findKey(message.meta.queues, queueUrl);
  message.cumulus_meta.execution_name = uuidv4();
}

/**
 * Enqueue a PDR to be parsed
 *
 * @param {Object} params
 * @param {Object} params.pdr - the PDR to be enqueued for parsing
 * @param {string} params.queueUrl - the SQS queue to add the message to
 * @param {string} params.parsePdrMessageTemplateUri - the S3 URI of template for
 * a PDR parse message
 * @param {Object} params.provider - the provider config to be attached to the message
 * @param {Object} params.collection - the collection config to be attached to the
 *   message
 * @param {string} params.parentExecutionArn - parent workflow execution arn to add to the message
 * @returns {Promise} - resolves when the message has been enqueued
 */
async function enqueueParsePdrMessage({
  pdr,
  queueUrl,
  parsePdrMessageTemplateUri,
  provider,
  collection,
  parentExecutionArn
}) {
  const message = await getMessageFromTemplate(parsePdrMessageTemplateUri);

  message.payload = { pdr };

  prepareExecutionQueueMessage({
    message,
    provider,
    collection,
    parentExecutionArn
  });

  const arn = getExecutionArn(
    message.cumulus_meta.state_machine,
    message.cumulus_meta.execution_name
  );
  await sendSQSMessage(queueUrl, message);
  return arn;
}
module.exports.enqueueParsePdrMessage = enqueueParsePdrMessage;

/**
 * Enqueue a granule to be ingested
 *
 * @param {Object} params
 * @param {Object} params.granule - the granule to be enqueued for ingest
 * @param {string} params.queueUrl - the SQS queue to add the message to
 * @param {string} params.granuleIngestMessageTemplateUri - the S3 URI of template for
 * a granule ingest message
 * @param {Object} params.provider - the provider config to be attached to the message
 * @param {Object} params.collection - the collection config to be attached to the
 *   message
 * @param {Object} params.pdr - an optional PDR to be configured in the message payload
 * @param {string} params.parentExecutionArn - parent workflow execution arn to add to the message
 * @returns {Promise} - resolves when the message has been enqueued
 */
async function enqueueGranuleIngestMessage({
  granule,
  queueUrl,
  granuleIngestMessageTemplateUri,
  provider,
  collection,
  pdr,
  parentExecutionArn
}) {
  // Build the message from a template
  const message = await getMessageFromTemplate(granuleIngestMessageTemplateUri);

  message.payload = {
    granules: [
      granule
    ]
  };
  if (pdr) message.meta.pdr = pdr;

  prepareExecutionQueueMessage({
    message,
    provider,
    collection,
    parentExecutionArn
  });

  const arn = getExecutionArn(
    message.cumulus_meta.state_machine,
    message.cumulus_meta.execution_name
  );
  await sendSQSMessage(queueUrl, message);
  return arn;
}
exports.enqueueGranuleIngestMessage = enqueueGranuleIngestMessage;
