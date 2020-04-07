const findKey = require('lodash/findKey');
const get = require('lodash/get');
const merge = require('lodash/merge');
const isString = require('lodash/isString');
const uuidv4 = require('uuid/v4');

const { constructCollectionId } = require('./collection-config-store');
const { deprecate, isNil } = require('./util');
const {
  getExecutionArn,
  getS3Object,
  parseS3Uri
} = require('./aws');

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
  deprecate('@cumulus/common/message.buildCumulusMeta()', '1.21.0', '@cumulus/message/Build.buildCumulusMeta()');
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
  deprecate('@cumulus/common/message.buildQueueMessageFromTemplate()', '1.21.0', '@cumulus/message/Build.buildQueueMessageFromTemplate()');
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

/**
 * Get collection ID from execution message.
 *
 * @param {Object} message - An execution message
 * @returns {string} - A collection ID
 */
const getCollectionIdFromMessage = (message) => {
  deprecate('@cumulus/common/message.getCollectionIdFromMessage()', '1.21.0', '@cumulus/message/Collections.getCollectionIdFromMessage()');
  return constructCollectionId(
    get(message, 'meta.collection.name'), get(message, 'meta.collection.version')
  );
};

/**
 * Get the maximum executions for a queue.
 *
 * @param {Object} message - A workflow message object
 * @param {string} queueName - A queue name
 * @returns {number} - Count of the maximum executions for the queue
 */
const getMaximumExecutions = (message, queueName) => {
  deprecate('@cumulus/common/message.getMaximumExecutions()', '1.21.0', '@cumulus/message/Queue.getMaximumExecutions()');
  const maxExecutions = get(message, `meta.queueExecutionLimits.${queueName}`);
  if (isNil(maxExecutions)) {
    throw new Error(`Could not determine maximum executions for queue ${queueName}`);
  }
  return maxExecutions;
};

/**
 * Get the execution name from a workflow message.
 *
 * @param {Object} message - A workflow message object
 * @returns {string} - An execution name
 */
const getMessageExecutionName = (message) => {
  deprecate('@cumulus/common/message.getMessageExecutionName()', '1.21.0', '@cumulus/message/Executions.getMessageExecutionName()');
  const executionName = get(message, 'cumulus_meta.execution_name');
  if (!isString(executionName)) {
    throw new Error('cumulus_meta.execution_name not set in message');
  }
  return executionName;
};

/**
 * Get granules from execution message.
 *
 * @param {Object} message - An execution message
 * @returns {Array<Object>|undefined} - An array of granule objects, or
 *   undefined if `message.payload.granules` is not set
 */
const getMessageGranules = (message) => {
  deprecate('@cumulus/common/message.getMessageGranules()', '1.21.0', '@cumulus/message/Granules.getMessageGranules()');
  return get(message, 'payload.granules');
};

/**
 * Get the state machine ARN from a workflow message.
 *
 * @param {Object} message - A workflow message object
 * @returns {string} - A state machine ARN
 */
const getMessageStateMachineArn = (message) => {
  deprecate('@cumulus/common/message.getMessageStateMachineArn()', '1.21.0', '@cumulus/message/Executions.getMessageStateMachineArn()');
  const stateMachineArn = get(message, 'cumulus_meta.state_machine');
  if (!isString(stateMachineArn)) {
    throw new Error('cumulus_meta.state_machine not set in message');
  }
  return stateMachineArn;
};

/**
 * Get the execution ARN from a workflow message.
 *
 * @param {Object} message - A workflow message object
 * @returns {null|string} - A state machine execution ARN
 */
const getMessageExecutionArn = (message) => {
  deprecate('@cumulus/common/message.getMessageExecutionArn()', '1.21.0', '@cumulus/message/Executions.getMessageExecutionArn()');
  try {
    return getExecutionArn(
      getMessageStateMachineArn(message),
      getMessageExecutionName(message)
    );
  } catch (err) {
    return null;
  }
};

/**
 * Get queue name by URL from execution message.
 *
 * @param {Object} message - An execution message
 * @param {string} queueUrl - An SQS queue URL
 * @returns {string} - An SQS queue name
 */
const getQueueNameByUrl = (message, queueUrl) => {
  deprecate('@cumulus/common/message.getQueueNameByUrl()', '1.21.0', '@cumulus/message/Queue.getQueueNameByUrl()');
  const queues = get(message, 'meta.queues', {});
  return findKey(queues, (value) => value === queueUrl);
};

/**
 * Get the queue name from a workflow message.
 *
 * @param {Object} message - A workflow message object
 * @returns {string} - A queue name
 */
const getQueueName = (message) => {
  deprecate('@cumulus/common/message.getQueueName()', '1.21.0', '@cumulus/message/Queue.getQueueName()');
  const queueName = get(message, 'cumulus_meta.queueName');
  if (isNil(queueName)) {
    throw new Error('cumulus_meta.queueName not set in message');
  }
  return queueName;
};

/**
 * Determine if there is a queue and queue execution limit in the message.
 *
 * @param {Object} message - A workflow message object
 * @returns {boolean} - True if there is a queue and execution limit.
 */
const hasQueueAndExecutionLimit = (message) => {
  deprecate('@cumulus/common/message.hasQueueAndExecutionLimit()', '1.21.0', '@cumulus/message/Queue.hasQueueAndExecutionLimit()');
  try {
    const queueName = getQueueName(message);
    getMaximumExecutions(message, queueName);
  } catch (err) {
    return false;
  }
  return true;
};

/**
 * Create a message from a template stored on S3
 *
 * @param {string} templateUri - S3 uri to the workflow template
 * @returns {Promise} message object
 **/
async function getMessageFromTemplate(templateUri) {
  deprecate('@cumulus/common/message.getMessageFromTemplate()', '1.21.0');
  const parsedS3Uri = parseS3Uri(templateUri);
  const data = await getS3Object(parsedS3Uri.Bucket, parsedS3Uri.Key);
  return JSON.parse(data.Body);
}

module.exports = {
  buildCumulusMeta,
  buildQueueMessageFromTemplate,
  getCollectionIdFromMessage,
  getMaximumExecutions,
  getMessageExecutionArn,
  getMessageExecutionName,
  getMessageFromTemplate,
  getMessageGranules,
  getMessageStateMachineArn,
  getQueueNameByUrl,
  getQueueName,
  hasQueueAndExecutionLimit
};
