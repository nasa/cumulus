const findKey = require('lodash.findkey');
const uuidv4 = require('uuid/v4');

const {
  getS3Object,
  parseS3Uri
} = require('./aws');

const buildCumulusMeta = ({
  queueName,
  parentExecutionArn
}) => {
  const cumulusMeta = {
    execution_name: uuidv4(),
    queueName
  };
  if (parentExecutionArn) cumulusMeta.parentExecutionArn = parentExecutionArn;
};

const getQueueNameByUrl = (message, queueUrl) =>
  findKey(message.meta.queues, (value) => value === queueUrl);

/**
 * Build an SQS message for queueing executions.
 *
 * @param {Object} params
 * @param {Object} params.provider - A provider object
 * @param {Object} params.collection - A collection object
 * @param {Object} params.parentExecutionArn - ARN for parent execution
 * @param {Object} params.queueUrl - SQS queue URL
 *
 * @returns {Object}
 */
function buildExecutionMessage({
  provider,
  collection,
  parentExecutionArn,
  queueUrl
}) {
  const queueName = getQueueNameByUrl(queueUrl);
  return {
    cumulus_meta: buildCumulusMeta({
      queueName,
      parentExecutionArn
    }),
    meta: {
      provider,
      collection
    }
  };
}

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

module.exports = {
  buildCumulusMeta,
  buildExecutionMessage,
  getMessageFromTemplate,
  getQueueNameByUrl
};
