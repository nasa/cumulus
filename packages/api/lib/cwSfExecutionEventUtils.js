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
 * Searches the Execution step History for the TaskStateEntered pertaining to
 * the failed task Id.  HistoryEvent ids are numbered sequentially, starting at
 * one.
*
 * @param {HistoryEvent[]} events - Step Function events array
 * @param {HistoryEvent} failedStepEvent - Step Function's failed event.
 * @returns {string} name of the current stepfunction task or 'UnknownFailedStepName'.
 */
const getFailedStepName = (events, failedStepEvent) => {
  try {
    const previousEvents = events.slice(0, failedStepEvent.id - 1);
    const startEvents = previousEvents.filter((e) => e.type === 'TaskStateEntered');
    return startEvents.pop().stateEnteredEventDetails.name;
  } catch (error) {
    log.info('Failed to determine a failed stepName from execution events.');
    log.error(error);
  }
  return 'UnknownFailedStepName';
};

/**
 * Finds all failed execution events and returns the last one in the list.
 *
 * @param {Array<HistoryEventList>} events - array of AWS Stepfunction execution HistoryEvents
 * @returns {HistoryEvent|[]} - the last lambda or activity that failed in the
 * event array, or an empty array.
 */
const lastFailedEventStep = (events) => {
  const failures = events.filter((event) =>
    ['LambdaFunctionFailed', 'ActivityFailed'].includes(event.type));
  return failures.pop();
};

/**
 * Get message to use for publishing failed execution notifications.
 *
 * Try to get the input to the last failed step in the execution so we can
 * update the status of any granules/PDRs that don't exist in the initial execution
 * input.
 *
 * Falls back to overall execution input.
 *
 * @param {Object} inputCumulusMessage - Workflow execution input message
 * @returns {Object} - CumulusMessage Execution step message or execution input message
 */
const getFailedExecutionMessage = async (inputCumulusMessage) => {
  const amendedCumulusMessage = { ...inputCumulusMessage };

  try {
    const executionArn = getMessageExecutionArn(amendedCumulusMessage);
    const { events } = await StepFunctions.getExecutionHistory({ executionArn });

    const lastFailedEvent = lastFailedEventStep(events);
    if (lastFailedEvent.length === 0) {
      log.warn(`No failed step events found in execution ${executionArn}`);
      return amendedCumulusMessage;
    }
    const failedExecutionStepName = getFailedStepName(events, lastFailedEvent);
    const failedStepExitedEvent = getStepExitedEvent(events, lastFailedEvent);

    if (!failedStepExitedEvent) {
      log.info(`Could not retrieve output from last failed step in execution ${executionArn}, falling back to execution input`);
      log.info(`Could not find TaskStateExited event after step ID ${lastFailedEvent.id} for execution ${executionArn}`);
      return {
        ...amendedCumulusMessage,
        exception: {
          ...lastFailedEvent.activityFailedEventDetails,
          ...lastFailedEvent.lambdaFunctionFailedEventDetails,
          failedExecutionStepName,

        },
      };
    }

    const taskExitedEventOutput = JSON.parse(getTaskExitedEventOutput(failedStepExitedEvent));
    taskExitedEventOutput.exception = {
      ...taskExitedEventOutput.exception,
      failedExecutionStepName,
    };
    return await parseStepMessage(taskExitedEventOutput, failedExecutionStepName);
  } catch (error) {
    log.error('getFailedExecution failed to retrieve failure:', error);
    return amendedCumulusMessage;
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

module.exports = {
  getFailedExecutionMessage,
  getCumulusMessageFromExecutionEvent,
};
