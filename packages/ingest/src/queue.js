'use strict';

const { getJsonS3Object } = require('@cumulus/aws-client/S3');
const { sendSQSMessage } = require('@cumulus/aws-client/SQS');

const { buildQueueMessageFromTemplate } = require('@cumulus/message/Build');
const { buildExecutionArn } = require('@cumulus/message/Executions');

const {
  getWorkflowFileKey,
  templateKey,
} = require('@cumulus/common/workflows');

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
 * @param {string} [params.executionNamePrefix] - the prefix to apply to the
 *   name of the enqueued execution
 * @param {Object} [params.additionalCustomMeta] - additional object to merge into meta object
 * @returns {Promise} - resolves when the message has been enqueued
 */
async function enqueueParsePdrMessage({
  collection,
  parentExecutionArn,
  parsePdrWorkflow,
  pdr,
  provider,
  stack,
  systemBucket,
  queueUrl,
  executionNamePrefix,
  additionalCustomMeta = {},
}) {
  const messageTemplate = await getJsonS3Object(systemBucket, templateKey(stack));
  const { arn: parsePdrArn } = await getJsonS3Object(
    systemBucket,
    getWorkflowFileKey(stack, parsePdrWorkflow)
  );
  const payload = { pdr };
  const workflow = {
    name: parsePdrWorkflow,
    arn: parsePdrArn,
  };

  const message = buildQueueMessageFromTemplate({
    messageTemplate,
    parentExecutionArn,
    payload,
    workflow,
    customMeta: {
      ...additionalCustomMeta,
      collection,
      provider,
    },
    executionNamePrefix,
  });

  const arn = buildExecutionArn(
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
 * @param {Object} params.granules - the granules to be enqueued for ingest
 * @param {string} params.queueUrl - the SQS queue to add the message to
 * @param {Object} params.messageTemplate - Message template for the workflow
 * @param {Object} params.workflow - workflow name & arn object
 * @param {Object} params.provider - the provider config to be attached to the message
 * @param {Object} params.collection - the collection config to be attached to the
 *   message
 * @param {string} params.parentExecutionArn - parent workflow execution arn to add to the message
 * @param {Object} [params.pdr] - an optional PDR to be configured in the message payload
 * @param {string} [params.executionNamePrefix] - the prefix to apply to the
 *   name of the enqueued execution
 * @param {Object} [params.additionalCustomMeta] - additional object to merge into meta object
 * @returns {Promise} - resolves when the message has been enqueued
 */
async function enqueueGranuleIngestMessage({
  collection,
  granules,
  parentExecutionArn,
  pdr,
  provider,
  messageTemplate,
  workflow,
  queueUrl,
  executionNamePrefix,
  additionalCustomMeta = {},
}) {
  const message = buildQueueMessageFromTemplate({
    messageTemplate,
    parentExecutionArn,
    payload: { granules },
    workflow,
    customMeta: {
      ...additionalCustomMeta,
      ...(pdr ? { pdr } : {}),
      collection,
      provider,
    },
    executionNamePrefix,
  });

  await sendSQSMessage(queueUrl, message);
  return buildExecutionArn(
    message.cumulus_meta.state_machine,
    message.cumulus_meta.execution_name
  );
}
exports.enqueueGranuleIngestMessage = enqueueGranuleIngestMessage;

/**
 * Enqueue a workflow
 *
 * @param {Object} params
 * @param {Object} params.workflow - the workflow to be enqueued
 * @param {Object} params.workflowInput - the input that should be passed to the queued workflow
 * @param {string} [params.queueUrl] - an optional SQS queue to add the message to
 * @param {Object} params.provider - the provider config to be attached to the message
 * @param {Object} params.collection - the collection config to be attached to the
 *   message
 * @param {string} params.parentExecutionArn - parent workflow execution arn to add to the message
 * @param {string} [params.executionNamePrefix] - the prefix to apply to the
 *   name of the enqueued execution
 * @returns {Promise} - resolves when the message has been enqueued
 */
async function enqueueWorkflowMessage({
  parentExecutionArn,
  stack,
  systemBucket,
  collection,
  provider,
  queueUrl,
  workflow,
  workflowInput,
  executionNamePrefix,
  additionalCustomMeta = {},
}) {
  const messageTemplate = await getJsonS3Object(systemBucket, templateKey(stack));
  const { arn: queuedWorkflowArn } = await getJsonS3Object(
    systemBucket,
    getWorkflowFileKey(stack, workflow)
  );

  const payload = {
    ...workflowInput,
  };

  const queuedWorkflowDefinition = {
    name: workflow,
    arn: queuedWorkflowArn,
  };

  const message = buildQueueMessageFromTemplate({
    messageTemplate,
    parentExecutionArn,
    payload,
    queueUrl,
    workflow: queuedWorkflowDefinition,
    executionNamePrefix,
    customMeta: {
      ...additionalCustomMeta,
      collection,
      provider,
    },
  });

  const arn = buildExecutionArn(
    message.cumulus_meta.state_machine,
    message.cumulus_meta.execution_name
  );

  await sendSQSMessage(queueUrl, message);

  return arn;
}
exports.enqueueWorkflowMessage = enqueueWorkflowMessage;
