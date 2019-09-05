const findKey = require('lodash.findkey');
const get = require('lodash.get');
const merge = require('lodash.merge');
const uuidv4 = require('uuid/v4');

const { constructCollectionId } = require('./collection-config-store');
const { isNil } = require('./util');

const {
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
  queueName,
  parentExecutionArn
}) => {
  const cumulusMeta = {
    execution_name: createExecutionName(),
    queueName
  };
  if (parentExecutionArn) cumulusMeta.parentExecutionArn = parentExecutionArn;
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
  provider
}) => {
  const meta = {};
  if (collection) {
    meta.collection = collection;
  }
  if (provider) {
    meta.provider = provider;
  }
  return meta;
};

/**
 * Get collection ID from execution message.
 *
 * @param {Object} message - An execution message
 * @returns {string} - A collection ID
 */
const getCollectionIdFromMessage = (message) =>
  constructCollectionId(
    get(message, 'meta.collection.name'), get(message, 'meta.collection.version')
  );

/**
 * Get queue name by URL from execution message.
 *
 * @param {Object} message - An execution message
 * @param {string} queueUrl - An SQS queue URL
 * @returns {string} - An SQS queue name
 */
const getQueueNameByUrl = (message, queueUrl) => {
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
  const queueName = get(message, 'cumulus_meta.queueName');
  if (isNil(queueName)) {
    throw new Error('cumulus_meta.queueName not set in message');
  }
  return queueName;
};

/**
 * Get the maximum executions for a queue.
 *
 * @param {Object} message - A workflow message object
 * @param {string} queueName - A queue name
 * @returns {number} - Count of the maximum executions for the queue
 */
const getMaximumExecutions = (message, queueName) => {
  const maxExecutions = get(message, `meta.queueExecutionLimits.${queueName}`);
  if (isNil(maxExecutions)) {
    throw new Error(`Could not determine maximum executions for queue ${queueName}`);
  }
  return maxExecutions;
};

/**
 * Determine if there is a queue and queue execution limit in the message.
 *
 * @param {Object} message - A workflow message object
 * @returns {boolean} - True if there is a queue and execution limit.
 */
const hasQueueAndExecutionLimit = (message) => {
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
  const parsedS3Uri = parseS3Uri(templateUri);
  const data = await getS3Object(parsedS3Uri.Bucket, parsedS3Uri.Key);
  return JSON.parse(data.Body);
}

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
  messageTemplate,
  payload,
  customCumulusMeta = {},
  customMeta = {}
}) {
  const cumulusMeta = buildCumulusMeta({
    parentExecutionArn,
    queueName
  });

  const meta = buildMeta({
    provider,
    collection
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
  buildCumulusMeta,
  buildQueueMessageFromTemplate,
  getCollectionIdFromMessage,
  getQueueNameByUrl,
  getQueueName,
  getMaximumExecutions,
  getMessageFromTemplate,
  hasQueueAndExecutionLimit
};
