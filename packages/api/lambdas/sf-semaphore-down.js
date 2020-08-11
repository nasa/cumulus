'use strict';

const {
  getSfEventMessageObject,
  getSfEventStatus,
  isSfExecutionEvent,
  isTerminalSfStatus
} = require('@cumulus/common/cloudwatch-event');
const {
  getQueueUrl,
  hasQueueAndExecutionLimit
} = require('@cumulus/message/Queue');
const stepFunctions = require('@cumulus/message/StepFunctions');

const { decrementQueueSemaphore } = require('../lib/SemaphoreUtils');

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
  && isTerminalSfStatus(getSfEventStatus(event))
  && hasQueueAndExecutionLimit(executionMessage);

/**
 * Handle Cloudwatch event and decrement semaphore, if necessary.
 *
 * @param {Object} event - incoming event from Cloudwatch
 */
async function handleSemaphoreDecrementTask(event) {
  let eventMessage = getSfEventMessageObject(event, 'output');
  if (!eventMessage) eventMessage = getSfEventMessageObject(event, 'input', '{}');
  const executionMessage = await stepFunctions.pullStepFunctionEvent(eventMessage);
  if (isDecrementEvent(event, executionMessage)) {
    const queueUrl = getQueueUrl(eventMessage);
    return decrementQueueSemaphore(queueUrl);
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
