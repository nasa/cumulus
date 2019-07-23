const get = require('lodash.get');
const has = require('lodash.has');

const { Execution } = require('@cumulus/api/models');

/**
 * Get message from SNS record.
 *
 * @param {Object} record - Record from SNS event
 * @returns {Object} - Message object from SNS record
 */
const getSnsMessage = (record) => JSON.parse(get(record, 'Sns.Message', '{}'));

/**
 * Determine if SNS message is an execution message.
 *
 * @param {Object} message - Message from SNS record
 * @returns {boolean} - true if message is an execution message
 */
const isExecutionMessage = (message) => has(message, 'meta.status');

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
 * Filter and map SNS records to get report execution tasks.
 *
 * @param {Object} event - Incoming event from SNS
 * @returns {Array<Promise>} - Array of promises for report execution tasks.
 */
function getReportExecutionTasks(event) {
  const records = get(event, 'Records', []);
  return records
    .map(getSnsMessage)
    .filter(isExecutionMessage)
    .map(handleExecutionMessage);
}

/**
 * Lambda handler for reportExecutions Lambda
 *
 * @param {Object} event - Incoming event from SNS
 * @returns {Promise}
 */
async function handler(event) {
  const tasks = getReportExecutionTasks(event);
  return Promise.all(tasks);
}

module.exports = {
  getReportExecutionTasks,
  handler
};
