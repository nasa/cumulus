const get = require('lodash.get');
const { isNil } = require('@cumulus/common/util');

/**
 * Get the queue name from a workflow message.
 *
 * @param {Object} message - A workflow message object
 * @returns {string} - A queue name
 */
const getQueueName = (message) => get(message, 'cumulus_meta.queueName');

/**
 * Get the maximum executions for a queue.
 *
 * @param {Object} message - A workflow message object
 * @returns {number} - Count of the aximum executions for the queue
 */
const getMaximumExecutions = (message, queueName) => get(message, `meta.queueExecutionLimits.${queueName}`);

/**
 * Determine if message specifies a queue name.
 *
 * @param {Object} message - A workflow message object
 * @returns {boolean} - True if message has a queue name.
 */
const hasQueueName = (message) => {
  const queueName = getQueueName(message);
  return !isNil(queueName);
}

/**
 * Determine if there is a maximum execution limit for a queue.
 *
 * @param {Object} message - A workflow message object
 * @returns {boolean} - True if queue has an execution limit.
 */
const hasExecutionLimit = (message) => {
  const queueName = getQueueName(message);
  const executionLimit = getMaximumExecutions(message, queueName);
  return !isNil(executionLimit);
}

module.exports = {
  getQueueName,
  getMaximumExecutions,
  hasQueueName,
  hasExecutionLimit
};
