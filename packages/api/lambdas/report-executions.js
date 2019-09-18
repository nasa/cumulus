const get = require('lodash.get');

const { getSnsEventMessageObject, isSnsEvent } = require('@cumulus/common/sns-event');
// Temporarily change require while this module resides in the API package
// const Execution = require('@cumulus/api/models/executions');
const Execution = require('../models/executions');

/**
 * Create/update execution record from SNS message.
 *
 * @param {Object} executionRecord - An execution record
 * @returns {Promise}
 */
async function createUpdateExecutionRecord(executionRecord) {
  const executionModel = new Execution();
  return executionModel.create(executionRecord);
}

/**
 * Filter and map SNS records to get execution records.
 *
 * @param {Object} event - Incoming event from SNS
 * @returns {Array<Object>} - Array of execution messages
 */
function getReportExecutionMessages(event) {
  const records = get(event, 'Records', []);
  return records
    .filter(isSnsEvent)
    .map(getSnsEventMessageObject);
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
    messages.map(createUpdateExecutionRecord)
  );
}

module.exports = {
  getReportExecutionMessages,
  handler
};
