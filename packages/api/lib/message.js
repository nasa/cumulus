const get = require('lodash.get');
const { isNil } = require('@cumulus/common/util');

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
}

/**
 * Get the maximum executions for a queue.
 *
 * @param {Object} message - A workflow message object
 * @returns {number} - Count of the maximum executions for the queue
 */
const getMaximumExecutions = (message, queueName) => {
  const maxExecutions = get(message, `meta.queueExecutionLimits.${queueName}`);
  if (isNil(maxExecutions)) {
    throw new Error(`Could not determine maximum executions for queue ${queueName}`);
  }
  return maxExecutions;
}

/**
 * Determine if message specifies a queue name.
 *
 * @param {Object} message - A workflow message object
 * @returns {boolean} - True if message has a queue name.
 */
const hasQueueName = (message) => {
  let queueName;
  try {
    queueName = getQueueName(message);
  } catch (err) {
    return false;
  }
  return !isNil(queueName);
}

/**
 * Determine if there is a maximum execution limit for a queue.
 *
 * @param {Object} message - A workflow message object
 * @returns {boolean} - True if queue has an execution limit.
 */
const hasExecutionLimit = (message) => {
  let executionLimit;
  try {
    const queueName = getQueueName(message);
    executionLimit = getMaximumExecutions(message, queueName);
  } catch (err) {
    return false;
  }
  return !isNil(executionLimit);
}

module.exports = {
  getQueueName,
  getMaximumExecutions,
  hasQueueName,
  hasExecutionLimit
};
