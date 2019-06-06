'use strict';

const {
  sendSQSMessage,
  getExecutionArn
} = require('@cumulus/common/aws');

const {
  buildQueueMessageFromTemplate,
  getMessageFromTemplate,
  getQueueNameByUrl
} = require('@cumulus/common/message');

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
  const messageTemplate = await getMessageFromTemplate(parsePdrMessageTemplateUri);
  const queueName = getQueueNameByUrl(messageTemplate, queueUrl);
  const message = buildQueueMessageFromTemplate({
    queueName,
    provider,
    collection,
    parentExecutionArn,
    messageTemplate
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
  const messageTemplate = await getMessageFromTemplate(granuleIngestMessageTemplateUri);
  // Should this throw? Probably not because it would prevent all the other messages
  // from being queued, since this function is invoked via Promise.all in queue-granules
  const queueName = getQueueNameByUrl(messageTemplate, queueUrl);
  const message = buildQueueMessageFromTemplate({
    queueName,
    provider,
    collection,
    parentExecutionArn,
    messageTemplate
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
