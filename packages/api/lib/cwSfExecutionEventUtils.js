'use strict';

const get = require('lodash/get');
const set = require('lodash/set');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const Logger = require('@cumulus/logger');
const {
  getStepExitedEvent,
  getTaskExitedEventOutput,
} = require('@cumulus/common/execution-history');
const { getMessageExecutionArn } = require('@cumulus/message/Executions');
const { parseStepMessage, pullStepFunctionEvent } = require('@cumulus/message/StepFunctions');

const log = new Logger({ sender: '@cumulus/api/lib/cwSfExecutionEventUtils' });

const executionStatusToWorkflowStatus = (executionStatus) => {
  const statusMap = {
    ABORTED: 'failed',
    FAILED: 'failed',
    RUNNING: 'running',
    SUCCEEDED: 'completed',
    TIMED_OUT: 'failed',
  };

  return statusMap[executionStatus];
};

/**
 * Get message to use for publishing failed execution notifications.
 *
 * Try to get the input to the first failed step in the execution so we can
 * update the status of any granules/PDRs that don't exist in the initial execution
 * input. Falls back to overall execution input.
 *
 * @param {Object} inputMessage - Workflow execution input message
 * @returns {Object} - Execution step message or execution input message
 */
const getFailedExecutionMessage = async (inputMessage) => {
  try {
    const executionArn = getMessageExecutionArn(inputMessage);
    const { events } = await StepFunctions.getExecutionHistory({ executionArn });

    const stepFailedEvents = events.filter(
      (event) =>
        ['ActivityFailed', 'LambdaFunctionFailed'].includes(event.type)
    );
    if (stepFailedEvents.length === 0) {
      log.info(`No failed step events found in execution ${executionArn}`);
      return inputMessage;
    }

    const lastStepFailedEvent = stepFailedEvents[stepFailedEvents.length - 1];
    const failedStepExitedEvent = getStepExitedEvent(events, lastStepFailedEvent);

    if (!failedStepExitedEvent) {
      log.info(
        `Could not retrieve output from last failed step in execution ${executionArn}, falling back to execution input`,
        'Error:', new Error(`Could not find TaskStateExited event after step ID ${lastStepFailedEvent.id} for execution ${executionArn}`)
      );

      const exception = lastStepFailedEvent.lambdaFunctionFailedEventDetails
        || lastStepFailedEvent.activityFailedEventDetails;

      // If input from the failed step cannot be retrieved, then fall back to execution
      // input.
      return {
        ...inputMessage,
        exception,
      };
    }

    const taskExitedEventOutput = getTaskExitedEventOutput(failedStepExitedEvent);
    return await parseStepMessage(
      JSON.parse(taskExitedEventOutput),
      failedStepExitedEvent.resource
    );
  } catch (error) {
    return inputMessage;
  }
};

const getCumulusMessageFromExecutionEvent = async (executionEvent) => {
  let cumulusMessage;

  if (executionEvent.detail.status === 'RUNNING') {
    cumulusMessage = JSON.parse(executionEvent.detail.input);
  } else if (executionEvent.detail.status === 'SUCCEEDED') {
    cumulusMessage = JSON.parse(executionEvent.detail.output);
  } else {
    const inputMessage = JSON.parse(get(executionEvent, 'detail.input', '{}'));
    cumulusMessage = await getFailedExecutionMessage(inputMessage);
  }

  const fullCumulusMessage = await pullStepFunctionEvent(cumulusMessage);

  const workflowStatus = executionStatusToWorkflowStatus(executionEvent.detail.status);
  set(fullCumulusMessage, 'meta.status', workflowStatus);

  set(fullCumulusMessage, 'cumulus_meta.workflow_stop_time', executionEvent.detail.stopDate);

  return fullCumulusMessage;
};

/**
 * Searches the Execution History for the TaskStateEntered pertaining to the failed task Id.
 * HistoryEvent ids are numbered sequentially, starting at one.
*
 * @param {HistoryEvent[]} events
 * @param {number} lastFailureId
 * @returns {string} name of the current stepfunction task or 'Unknown FailedStepName'.
 */
const failedStepName = (events, lastFailureId) => {
  try {
    const previousEvents = events.slice(0, lastFailureId - 1);
    const startEvents = previousEvents.filter((e) => e.type === 'TaskStateEntered');
    return startEvents.pop().stateEnteredEventDetails.name;
  } catch (error) {
    log.info('Failed to determine a failed stepName from execution events.');
    log.error(error);
  }
  return 'Unknown FailedStepName';
};

/**
 * Finds all failed execution events and returns the last one in the list.
 *
 * @param {Array<HistoryEventList>} events - array of AWS Stepfunction execution HistoryEvents
 * @returns {HistoryEvent|[]} - the last lambda or activity that failed in the
 * event array, or an empty array.
 */
const lastExecutionFailure = (events) => {
  const failures = events.filter((event) =>
    ['LambdaFunctionFailed', 'ActivityFailed'].includes(event.type));
  return failures.pop();
};

module.exports = {
  failedStepName,
  getFailedExecutionMessage,
  getCumulusMessageFromExecutionEvent,
  lastExecutionFailure,
};
