const get = require('lodash.get');
const { isNil } = require('@cumulus/common/util');

/**
 * Determine if message specifies a queue name.
 *
 * @param {Object} message - A workflow message object
 * @returns {boolean} - True if message has a queue name.
 */
const hasQueueName = (message) => {
  const queueName = get(message, 'cumulus_meta.queueName');
  return !isNil(queueName);
}

/**
 * Determine if there is a maximum execution limit for a queue.
 *
 * @param {Object} message - A workflow message object
 * @returns {boolean} - True if queue has an execution limit.
 */
const hasExecutionLimit = (message) => {
  const queueName = get(message, 'cumulus_meta.queueName');
  const executionLimit  = get(message, `meta.queueExecutionLimits.${queueName}`);
  return !isNil(executionLimit);
}

module.exports = {
  hasQueueName,
  hasExecutionLimit
};
