'use strict';

const get = require('lodash.get');
const {
  aws,
  log,
  Semaphore
} = require('@cumulus/common');
const { isOneOf } = require('@cumulus/common/util');

const {
  getQueueName,
  hasQueueAndExecutionLimit
} = require('../lib/message');

/**
 * Determine if Cloudwatch event is a Step Function state update.
 *
 * @param {Object} event - A Cloudwatch event object
 * @returns {boolean} - True if event is a Step Function state update.
 */
const isSfExecutionEvent = (event) => event.source === 'aws.states';

/**
 * Determine if workflow is in a terminal state.
 *
 * @param {Object} status - A Step Function execution status
 * @returns {boolean} - True if workflow is in terminal state.
 */
const isTerminalStatus = isOneOf([
  'ABORTED',
  'COMPLETED',
  'FAILED',
  'TIMED_OUT'
]);

const getEventStatus = (event) => get(event, 'detail.status');

const getEventMessage = (event) => JSON.parse(get(event, 'detail.output', {}));

/**
 * Determine if workflow needs a semaphore decrement.
 *
 * Skip if:
 *   - Event has no specified queue name
 *   - Queue name for event has no maximum execution limit
 *   - Event has no workflow status
 *   - Workflow is not in a terminal state
 *
 * @param {Object} event - A workflow execution event
 * @returns {boolean} True if workflow execution semaphore should be decremented
 */
const isDecrementEvent = (event) =>
  isSfExecutionEvent(event)
  && hasQueueAndExecutionLimit(getEventMessage(event))
  && isTerminalStatus(getEventStatus(event));

/**
 * Decrement semaphore value for executions started from a queue
 *
 * @param {string} queueName - Queue name used as key for semaphore tracking
 *   running executions
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
 * Handle Cloudwatch event and decrement semaphore, if necessary.
 *
 * @param {Object} event - incoming event from Cloudwatch
 * @returns {Promise}
 */
async function handleSemaphoreDecrementTask(event) {
  if (isDecrementEvent(event)) {
    const message = getEventMessage(event);
    const queueName = getQueueName(message);
    await decrementQueueSemaphore(queueName);
  }
}

/**
 * Lambda function handler for sfSemaphoreDown
 *
 * @param {Object} event - incoming message from Cloudwatch
 * @returns {Promise}
 */
async function handler(event) {
  return handleSemaphoreDecrementTask(event);
}

module.exports = {
  handleSemaphoreDecrementTask,
  handler
};
