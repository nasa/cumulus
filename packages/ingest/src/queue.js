'use strict';

const { getJsonS3Object } = require('@cumulus/aws-client/S3');
const { sendSQSMessage } = require('@cumulus/aws-client/SQS');

const { buildQueueMessageFromTemplate } = require('@cumulus/message/Build');
const { buildExecutionArn } = require('@cumulus/message/Executions');

const {
  getWorkflowFileKey,
  templateKey,
} = require('@cumulus/common/workflows');

const CmrProviderNotConfiguredMessage = 'all collections must configure a cmr_provider for sf to be scheduled';
class CMRProviderNotConfiguredError extends Error {
  constructor(error) {
    super(`${error.message} ${CmrProviderNotConfiguredMessage}`);

    this.name = 'CMRProviderNotConfiguredError';
    this.code = error.code;

    Error.captureStackTrace(this, CMRProviderNotConfiguredError);
  }
}
/**
 * @typedef { import('@cumulus/types/api/collections').CollectionRecord } CollectionRecord
 * @param {object} messageTemplate
 * @param {CollectionRecord | undefined} collection
 */
function joinCollectionProviderToTemplateCmrMeta(messageTemplate, collection) {

  const cmrProvider = collection?.cmrProvider || '';
  if (cmrProvider == null || cmrProvider == undefined) {
    throw new CMRProviderNotConfiguredError({
      message: `no cmr_provider found for collection ${collection.name}___${collection.version}`,
    });
  }
  const templateCmr = messageTemplate?.meta?.cmr || {}
  return {
    ...templateCmr,
    provider: cmrProvider
  }
}
exports.joinCollectionProviderToTemplateCmrMeta = joinCollectionProviderToTemplateCmrMeta
/**
 * Enqueue a PDR to be parsed
 *
 * @param {object} params
 * @param {object} params.collection         - the collection config to be attached to the message
 * @param {string} params.parentExecutionArn - parent workflow execution arn to add to the message
 * @param {string} params.parsePdrWorkflow   - the S3 URI of template for a PDR parse message
 * @param {object} params.pdr                - the PDR to be enqueued for parsing
 * @param {object} params.provider           - the provider config to be attached to the message
 * @param {string} params.stack              - stack name
 * @param {string} params.systemBucket       - system bucket name
 * @param {string} params.queueUrl           - the SQS queue to add the message to
 * @param {string} [params.executionNamePrefix]
 *   - the prefix to apply to the name of the enqueued execution
 * @param {object} [params.additionalCustomMeta]
 *   - additional object to merge into meta object
 * @returns {Promise<string>}
 *   - resolves when the message has been enqueued
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
  const cmrMeta = joinCollectionProviderToTemplateCmrMeta(collection, messageTemplate);
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
      cmr: cmrMeta,
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
 * @param {object} params
 * @param {object} params.collection      - the collection config to be attached to the message
 * @param {object} params.granules        - the granules to be enqueued for ingest
 * @param {string} params.parentExecutionArn
 *   - parent workflow execution arn to add to the message
 * @param {object} params.provider        - the provider config to be attached to the message
 * @param {object} params.messageTemplate - Message template for the workflow
 * @param {object} params.workflow        - workflow name & arn object
 * @param {string} params.queueUrl        - the SQS queue to add the message to
 * @param {object | undefined} [params.pdr]
 *   - an optional PDR to be configured in the message payload
 * @param {string} [params.executionNamePrefix]
 *   - the prefix to apply to the name of the enqueued execution
 * @param {object} [params.additionalCustomMeta]
 *   - additional object to merge into meta object
 * @returns {Promise<string>}
 *   - resolves when the message has been enqueued
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
 * @param {object} params
 * @param {string} params.parentExecutionArn
 *   - parent workflow execution arn to add to the message
 * @param {string} params.stack         - stack name
 * @param {string} params.systemBucket  - system bucket name
 * @param {object} params.collection    - the collection config to be attached to the message
 * @param {object} params.provider      - the provider config to be attached to the message
 * @param {object} params.workflow      - the workflow to be enqueued
 * @param {object} params.workflowInput - the input that should be passed to the queued workflow
 * @param {string} [params.queueUrl]    - an optional SQS queue to add the message to
 * @param {string} [params.executionNamePrefix]
 *   - the prefix to apply to the name of the enqueued execution
 * @returns {Promise<string>}
 *   - resolves when the message has been enqueued
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
