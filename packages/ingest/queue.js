'use strict';

const merge = require('lodash.merge');

const {
  sendSQSMessage,
  getExecutionArn
} = require('@cumulus/common/aws');

const {
  buildExecutionMessage,
  getMessageFromTemplate
} = require('@cumulus/common/message');

async function buildMessageFromTemplate({
  provider,
  collection,
  parentExecutionArn,
  queueUrl,
  templateUri
}) {
  const messageTemplate = await getMessageFromTemplate(templateUri);
  const message = buildExecutionMessage({
    provider,
    collection,
    parentExecutionArn,
    queueUrl
  });

  return {
    ...messageTemplate,
    meta: merge(messageTemplate.meta, message.meta),
    cumulus_meta: merge(messageTemplate.cumulus_meta, message.cumulus_meta)
  };
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
  // const message = await getMessageFromTemplate(parsePdrMessageTemplateUri);
  const message = buildMessageFromTemplate({
    queueUrl,
    provider,
    collection,
    parentExecutionArn,
    templateUri: parsePdrMessageTemplateUri
  });

  message.payload = { pdr };

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
  // const message = await getMessageFromTemplate(granuleIngestMessageTemplateUri);
  const message = buildMessageFromTemplate({
    queueUrl,
    provider,
    collection,
    parentExecutionArn,
    templateUri: granuleIngestMessageTemplateUri
  });

  message.payload = {
    granules: [
      granule
    ]
  };
  if (pdr) message.meta.pdr = pdr;

  const arn = getExecutionArn(
    message.cumulus_meta.state_machine,
    message.cumulus_meta.execution_name
  );

  await sendSQSMessage(queueUrl, message);

  return arn;
}
exports.enqueueGranuleIngestMessage = enqueueGranuleIngestMessage;
