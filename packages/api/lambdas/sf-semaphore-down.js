const get = require('lodash.get');
const has = require('lodash.has');
const { isNil } = require('@cumulus/common/util');
const {
  aws,
  log,
  Semaphore
} = require('@cumulus/common');

const {
  getQueueName,
  hasQueueName,
  hasExecutionLimit
} = require('../lib/message');

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
 *   - Message has no specified queue name
 *   - Queue name for message has no maximum execution limit
 *   - Message has no workflow status
 *   - Workflow is not in a terminal state (failed/completed)
 *
 * @param {Object} message - A workflow message object
 * @returns {boolean} True if workflow semaphore should be decremented.
 */
const isDecrementMessage = (message) =>
  hasQueueName(message)
  && hasExecutionLimit(message)
  && has(message, 'meta.status')
  && isTerminalMessage(message);

/**
 * Decrement semaphore value for executions started from a queue
 *
 * @param {string} queueName - Queue name used as key for semaphore tracking running executions
 * @returns {Promise} A promise indicating function completion
 * @throws {Error} Error from semaphore.down() operation
 */
async function decrementQueueSemaphore(queueName) {
  const semaphore = new Semaphore(
    aws.dynamodbDocClient(),
    process.env.SemaphoresTable
  );

  // Error should only be thrown if we are attempting to decrement the
  // count below 0. If so, catch the error so it can be logged.
  try {
    await semaphore.down(queueName);
  } catch (err) {
    log.error(`Failure: attempted to decrement semaphore for queue ${queueName} below 0`);
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
    .map((message) => getQueueName(message))
    .map((queueName) => decrementQueueSemaphore(queueName));
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
