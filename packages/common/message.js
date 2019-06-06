const findKey = require('lodash.findkey');
const get = require('lodash.get');
const merge = require('lodash.merge');
const uuidv4 = require('uuid/v4');

const {
  getS3Object,
  parseS3Uri
} = require('./aws');

const createExecutionName = () => uuidv4();

/**
 * Build message.cumulus_meta for an execution.
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
  customCumulusMeta = {},
  customMeta = {}
}) {
  const cumulusMeta = buildCumulusMeta({
    parentExecutionArn,
    queueName
  });

  const meta = {
    provider,
    collection
  };

  return {
    ...messageTemplate,
    meta: merge(messageTemplate.meta, customMeta, meta),
    cumulus_meta: merge(messageTemplate.cumulus_meta, customCumulusMeta, cumulusMeta)
  };
}

module.exports = {
  buildCumulusMeta,
  buildQueueMessageFromTemplate,
  getMessageFromTemplate,
  getQueueNameByUrl
};
