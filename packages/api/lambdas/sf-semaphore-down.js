const get = require('lodash.get');
const has = require('lodash.has');
const { isNil } = require('@cumulus/common/util');
const {
  concurrency: {
    Semaphore
  },
  aws,
  log
} = require('@cumulus/common');

/**
 * Determine if workflow is in a terminal state.
 *
 * @param {Object} message - A workflow message object
 * @returns {boolean} - True if workflow is in terminal state.
 */
const isTerminalMessage = (message) =>
  message.meta.status === 'failed' || message.meta.status === 'completed';

/**
 * Determine if workflow needs a semaphore decrement.
 *
 * Skip if:
 *   - Message has no priority level
 *   - Message has no workflow status
 *   - Workflow is not in a terminal state (failed/completed)
 *
 * @param {Object} message - A workflow message object
 * @returns {boolean} True if workflow semaphore should be decremented.
 */
const isDecrementMessage = (message) =>
  has(message, 'cumulus_meta.priorityKey') &&
  has(message, 'meta.status') &&
  isTerminalMessage(message);

/**
 * Decrement semaphore value for executions with priority
 *
 * @param {string} key - Key for a semaphore tracking running executions
 * @returns {Promise} A promise indicating function completion
 * @throws {Error} Error from semaphore.down() operation
 */
async function decrementPrioritySemaphore(key) {
  const semaphore = new Semaphore(
    aws.dynamodbDocClient(),
    process.env.SemaphoresTable
  );

  // Error should only be thrown if we are attempting to decrement the
  // count below 0. If so, catch the error so it can be logged.
  try {
    await semaphore.down(key);
  } catch (err) {
    log.error(`Failure: attempted to decrement semaphore for key ${key} below 0`);
    throw err;
  }
}

/**
 * Filter workflow messages from SNS to prepare array of semaphore decrement tasks.
 *
 * @param {Object} event - incoming message from SNS
 * @returns {Array<Promise>} - Array of promises for semaphore decrement operations
 */
function getSemaphoreDecrementTasks(event) {
  return get(event, 'Records', [])
    // Skip if this record is not from SNS or if the SNS message is empty
    .filter((record) => has(record, 'Sns.Message') && !isNil(record.Sns.Message))
    .map((record) => JSON.parse(record.Sns.Message))
    .filter((message) => isDecrementMessage(message))
    .map((message) => decrementPrioritySemaphore(message.cumulus_meta.priorityKey));
}

/**
 * Lambda function handler for sfSemaphoreDown
 *
 * @param {Object} event - incoming message from SNS
 * @returns {Promise}
 */
async function handler(event) {
  return Promise.all(
    getSemaphoreDecrementTasks(event)
  );
}

module.exports = {
  getSemaphoreDecrementTasks,
  handler
};
