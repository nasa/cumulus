'use strict';

const uuidv4 = require('uuid/v4');

const aws = require('@cumulus/common/aws');

/**
 * Create a message from a template stored on S3
 *
 * @param {string} templateUri - S3 uri to the workflow template
 * @returns {Promise} message object
 **/
async function getMessageFromTemplate(templateUri) {
  const parsedS3Uri = aws.parseS3Uri(templateUri);
  const data = await aws.getS3Object(parsedS3Uri.Bucket, parsedS3Uri.Key);
  return JSON.parse(data.Body);
}

/**
 * Enqueue a PDR to be parsed
 *
 * @param {Object} pdr - the PDR to be enqueued for parsing
 * @param {string} queueUrl - the SQS queue to add the message to
 * @param {string} parsePdrMessageTemplateUri - the S3 URI of template for
 * a granule ingest message
 * @param {Object} provider - the provider config to be attached to the message
 * @param {Object} collection - the collection config to be attached to the
 *   message
 * @param {string} parentExecutionArn - parent workflow execution arn to add to the message
 * @returns {Promise} - resolves when the message has been enqueued
 */
async function enqueueParsePdrMessage(
  pdr,
  queueUrl,
  parsePdrMessageTemplateUri,
  provider,
  collection,
  parentExecutionArn
) {
  const message = await getMessageFromTemplate(parsePdrMessageTemplateUri);

  message.meta.provider = provider;
  message.meta.collection = collection;

  message.payload = { pdr };

  if (parentExecutionArn) message.cumulus_meta.parentExecutionArn = parentExecutionArn;

  message.cumulus_meta.execution_name = uuidv4();
  const arn = aws.getExecutionArn(
    message.cumulus_meta.state_machine,
    message.cumulus_meta.execution_name
  );
  await aws.sendSQSMessage(queueUrl, message);
  return arn;
}
module.exports.enqueueParsePdrMessage = enqueueParsePdrMessage;

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
 * @param {string} parentExecutionArn - parent workflow execution arn to add to the message
 * @returns {Promise} - resolves when the message has been enqueued
 */
async function enqueueGranuleIngestMessage(
  granule,
  queueUrl,
  granuleIngestMessageTemplateUri,
  provider,
  collection,
  pdr,
  parentExecutionArn
) {
  // Build the message from a template
  const message = await getMessageFromTemplate(granuleIngestMessageTemplateUri);

  message.payload = {
    granules: [ granule ]
  };
  if (pdr) message.meta.pdr = pdr;

  message.meta.provider = provider;
  message.meta.collection = collection;
  if (parentExecutionArn) message.cumulus_meta.parentExecutionArn = parentExecutionArn;

  message.cumulus_meta.execution_name = uuidv4();
  const arn = aws.getExecutionArn(
    message.cumulus_meta.state_machine,
    message.cumulus_meta.execution_name
  );
  await aws.sendSQSMessage(queueUrl, message);
  return arn;
}
exports.enqueueGranuleIngestMessage = enqueueGranuleIngestMessage;
