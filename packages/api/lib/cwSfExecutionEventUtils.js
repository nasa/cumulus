'use strict';

const get = require('lodash.get');
const set = require('lodash.set');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const { pullStepFunctionEvent } = require('@cumulus/aws-client/StepFunctions');
const log = require('@cumulus/common/log');
const { getMessageExecutionArn } = require('@cumulus/common/message');
const {
  getStepExitedEvent,
  getTaskExitedEventOutput
} = require('@cumulus/common/execution-history');
const { SfnStep } = require('@cumulus/common/sfnStep');

const executionStatusToWorkflowStatus = (executionStatus) => {
  const statusMap = {
    ABORTED: 'failed',
    FAILED: 'failed',
    RUNNING: 'running',
    SUCCEEDED: 'completed',
    TIMED_OUT: 'failed'
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
        exception
      };
    }

    const taskExitedEventOutput = getTaskExitedEventOutput(failedStepExitedEvent);
    return await SfnStep.parseStepMessage(
      JSON.parse(taskExitedEventOutput),
      failedStepExitedEvent.resource
    );
  } catch (err) {
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

  set(fullCumulusMessage, 'cumulus_meta.workflow_start_time', executionEvent.detail.startDate);
  set(fullCumulusMessage, 'cumulus_meta.workflow_stop_time', executionEvent.detail.stopDate);

  return fullCumulusMessage;
};

module.exports = {
  getFailedExecutionMessage,
  getCumulusMessageFromExecutionEvent
};
