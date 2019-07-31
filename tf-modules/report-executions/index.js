const get = require('lodash.get');
const has = require('lodash.has');

const { getSnsEventMessageObject, isSnsEvent } = require('@cumulus/common/sns-event');
const Execution = require('@cumulus/api/models/executions');

/**
 * Determine if SNS message has an execution status.
 *
 * Note: Assuming CUMULUS-1394 will ensure `meta.status` is always set. Currently
 * it is not set for running executions.
 *
 * @param {Object} message - Message from SNS record
 * @returns {boolean} - true if message has an execution status
 */
const hasExecutionStatus = (message) => has(message, 'meta.status');

/**
 * Create/update execution record from SNS message.
 *
 * @param {Object} message - An execution message
 * @returns {Promise} - Promise from execution create/update record operation
 */
async function handleExecutionMessage(message) {
  const executionModel = new Execution();

  if (['failed', 'completed'].includes(message.meta.status)) {
    return executionModel.updateExecutionFromSns(message);
  }

  return executionModel.createExecutionFromSns(message);
}

/**
 * Filter and map SNS records to get report execution messages.
 *
 * @param {Object} event - Incoming event from SNS
 * @returns {Array<Object>} - Array of execution messages
 */
function getReportExecutionMessages(event) {
  const records = get(event, 'Records', []);
  return records
    .filter(isSnsEvent)
    .map(getSnsEventMessageObject)
    .filter(hasExecutionStatus);
}

/**
 * Lambda handler for reportExecutions Lambda
 *
 * @param {Object} event - Incoming event from SNS
 * @returns {Promise}
 */
async function handler(event) {
  const messages = getReportExecutionMessages(event);
  return Promise.all(
    messages.map(handleExecutionMessage)
  );
}

module.exports = {
  getReportExecutionMessages,
  handler
};
