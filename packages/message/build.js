const merge = require('lodash.merge');
const uuidv4 = require('uuid/v4');

const createExecutionName = () => uuidv4();

/**
 * Build base message.cumulus_meta for a queued execution.
 *
 * @param {Object} params
 * @param {string} params.queueName - An SQS queue name
 * @param {Object} params.parentExecutionArn - Parent execution ARN
 * @returns {Object}
 */
const buildCumulusMeta = ({
  asyncOperationId,
  parentExecutionArn,
  queueName,
  stateMachine
}) => {
  const cumulusMeta = {
    execution_name: createExecutionName(),
    queueName,
    state_machine: stateMachine
  };
  if (parentExecutionArn) cumulusMeta.parentExecutionArn = parentExecutionArn;
  if (asyncOperationId) cumulusMeta.asyncOperationId = asyncOperationId;
  return cumulusMeta;
};

/**
 * Build base message.meta for a queued execution.
 *
 * @param {Object} params
 * @param {string} params.queueName - An SQS queue name
 * @param {Object} params.parentExecutionArn - Parent execution ARN
 * @returns {Object}
 */
const buildMeta = ({
  collection,
  provider,
  workflowName
}) => {
  const meta = {
    workflow_name: workflowName
  };
  if (collection) {
    meta.collection = collection;
  }
  if (provider) {
    meta.provider = provider;
  }
  return meta;
};

/**
 * Build an SQS message from a workflow template for queueing executions.
 *
 * @param {Object} params
 * @param {Object} params.provider - A provider object
 * @param {Object} params.collection - A collection object
 * @param {string} params.parentExecutionArn - ARN for parent execution
 * @param {string} params.queueName - SQS queue name
 * @param {Object} params.messageTemplate - Message template for the workflow
 * @param {Object} params.payload - Payload for the workflow
 * @param {Object} params.workflow - workflow name & arn object
 * @param {Object} params.customCumulusMeta - Custom data for message.cumulus_meta
 * @param {Object} params.customMeta - Custom data for message.meta
 *
 * @returns {Object} - An SQS message object
 */
function buildQueueMessageFromTemplate({
  provider,
  collection,
  parentExecutionArn,
  queueName,
  asyncOperationId,
  messageTemplate,
  payload,
  workflow,
  customCumulusMeta = {},
  customMeta = {}
}) {
  const cumulusMeta = buildCumulusMeta({
    asyncOperationId,
    parentExecutionArn,
    queueName,
    stateMachine: workflow.arn
  });

  const meta = buildMeta({
    collection,
    provider,
    workflowName: workflow.name
  });

  const message = {
    ...messageTemplate,
    meta: merge(messageTemplate.meta, customMeta, meta),
    cumulus_meta: merge(messageTemplate.cumulus_meta, customCumulusMeta, cumulusMeta),
    payload
  };

  return message;
}

module.exports = {
  buildQueueMessageFromTemplate
};
