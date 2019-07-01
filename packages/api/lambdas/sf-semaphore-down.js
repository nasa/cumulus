'use strict';

const get = require('lodash.get');
const {
  getQueueName,
  hasQueueAndExecutionLimit
} = require('@cumulus/common/message');

const { pullStepFunctionEvent } = require('@cumulus/common/aws');
const { isOneOf } = require('@cumulus/common/util');

const { decrementQueueSemaphore } = require('../lib/semaphore');

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
  'SUCCEEDED',
  'FAILED',
  'TIMED_OUT'
]);

const getEventStatus = (event) => get(event, 'detail.status');

const getEventMessage = (event) => JSON.parse(get(event, 'detail.output', '{}'));

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
 * @param {Object} executionMessage - A cumulus event message
 * @returns {boolean} True if workflow execution semaphore should be decremented
 */
const isDecrementEvent = (event, executionMessage) =>
  isSfExecutionEvent(event)
  && isTerminalStatus(getEventStatus(event))
  && hasQueueAndExecutionLimit(executionMessage);

/**
 * Handle Cloudwatch event and decrement semaphore, if necessary.
 *
 * @param {Object} event - incoming event from Cloudwatch
 */
async function handleSemaphoreDecrementTask(event) {
  const eventMessage = getEventMessage(event);
  const executionMessage = await pullStepFunctionEvent(eventMessage);
  if (isDecrementEvent(event, executionMessage)) {
    const queueName = getQueueName(eventMessage);
    return decrementQueueSemaphore(queueName);
  }
  return 'Not a valid decrement event, no operation performed';
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
  isDecrementEvent,
  handleSemaphoreDecrementTask,
  handler
};
