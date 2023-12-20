'use strict';

/**
 * Utility functions for working with AWS Step Function events/messages
 * @module StepFunctions
 *
 * @example
 * const StepFunctions = require('@cumulus/message/StepFunctions');
 */

import { EventBridgeEvent } from 'aws-lambda';
import { JSONPath } from 'jsonpath-plus';
import get from 'lodash/get';
import set from 'lodash/set';

import { getExecutionHistory, HistoryEvent } from '@cumulus/aws-client/StepFunctions';
import { getStepExitedEvent, getTaskExitedEventOutput } from '@cumulus/common/execution-history';
import { Message } from '@cumulus/types';
import * as s3Utils from '@cumulus/aws-client/S3';
import Logger from '@cumulus/logger';

import { getMessageExecutionArn } from './Executions';

const log = new Logger({
  sender: '@cumulus/message/StepFunctions',
});
type ExecutionStatus = ('ABORTED' | 'RUNNING' | 'TIMED_OUT' | 'SUCCEEDED' | 'FAILED');

type ExecutionStatusToWorkflowStatusMap = {
  [K in ExecutionStatus]: Message.WorkflowStatus;
};

const executionStatusToWorkflowStatus = (
  executionStatus: ExecutionStatus
): Message.WorkflowStatus => {
  const statusMap: ExecutionStatusToWorkflowStatusMap = {
    ABORTED: 'failed',
    FAILED: 'failed',
    RUNNING: 'running',
    SUCCEEDED: 'completed',
    TIMED_OUT: 'failed',
  };

  return statusMap[executionStatus];
};

/**
 * Given a Step Function event, replace specified key in event with contents
 * of S3 remote message
 *
 * @param {Message.CumulusRemoteMessage} event - Source event
 * @returns {Promise<Object>} Updated event with target path replaced by remote message
 * @throws {Error} if target path cannot be found on source event
 *
 * @async
 * @alias module:StepFunctions
 */
export const pullStepFunctionEvent = async (
  event: {
    replace?: Message.ReplaceConfig
  }
): Promise<unknown> => {
  if (!event.replace) return event;

  const remoteMsg = await s3Utils.getJsonS3Object(
    event.replace.Bucket,
    event.replace.Key
  );

  let returnEvent = remoteMsg;
  if (event.replace.TargetPath) {
    const replaceNodeSearch = JSONPath({
      path: event.replace.TargetPath,
      json: event,
      resultType: 'all',
    });
    if (replaceNodeSearch.length !== 1) {
      throw new Error(`Replacement TargetPath ${event.replace.TargetPath} invalid`);
    }
    if (replaceNodeSearch[0].parent) {
      replaceNodeSearch[0].parent[replaceNodeSearch[0].parentProperty] = remoteMsg;
      returnEvent = event;
      delete returnEvent.replace;
    }
  }
  return returnEvent;
};

/**
 * Parse step message with CMA keys and replace specified key in event with contents
 * of S3 remote message
 *
 * @param {CMAMessage} stepMessage - Message for the step
 * @param {string} stepName - Name of the step
 * @returns {Promise<Object>} Parsed and updated event with target path replaced by remote message
 *
 * @async
 * @alias module:StepFunctions
 */
export const parseStepMessage = async (
  stepMessage: Message.CMAMessage,
  stepName: string
) => {
  let parsedMessage;
  if (stepMessage.cma) {
    const flattenedMessage = { ...stepMessage, ...stepMessage.cma, ...stepMessage.cma.event };
    delete flattenedMessage.cma;
    delete flattenedMessage.event;
    parsedMessage = flattenedMessage;
  } else {
    parsedMessage = stepMessage;
  }

  if (parsedMessage.replace) {
    // Message was too large and output was written to S3
    log.info(`Retrieving ${stepName} output from ${JSON.stringify(parsedMessage.replace)}`);
    parsedMessage = await pullStepFunctionEvent(parsedMessage);
  }
  return <Message.CumulusMessage>parsedMessage;
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
export const getFailedStepName = (
  events: HistoryEvent[],
  failedStepEvent: { id: number }
) => {
  try {
    const previousEvents = events.slice(0, failedStepEvent.id - 1);
    const startEvents = previousEvents.filter(
      (e) => e.type === 'TaskStateEntered'
    );
    const stateName = startEvents.pop()?.stateEnteredEventDetails?.name;
    if (!stateName) throw new Error('TaskStateEntered Event Object did not have `stateEnteredEventDetails.name`');
    return stateName;
  } catch (error) {
    log.info('Failed to determine a failed stepName from execution events.');
    log.error(error);
  }
  return 'UnknownFailedStepName';
};

/**
 * Finds all failed execution events and returns the last one in the list.
 *
 * @param {HistoryEvent[]} events - array of AWS Stepfunction execution HistoryEvents
 * @returns {HistoryEvent[] | undefined} - the last lambda or activity that failed in the
 * event array, or an empty array.
 */
export const lastFailedEventStep = (
  events: HistoryEvent[]
): HistoryEvent | undefined => {
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
 * @param {Function} getExecutionHistoryFunction - Testing override for mock/etc of
 *                                                 StepFunctions.getExecutionHistory
 * @returns {Object} - CumulusMessage Execution step message or execution input message
 */
export const getFailedExecutionMessage = async (
  inputCumulusMessage: Message.CumulusMessage,
  getExecutionHistoryFunction: typeof getExecutionHistory = getExecutionHistory
) => {
  const amendedCumulusMessage = { ...inputCumulusMessage };

  try {
    const executionArn = getMessageExecutionArn(amendedCumulusMessage);
    if (!executionArn) { throw new Error('No execution arn found'); }
    const { events } = await getExecutionHistoryFunction({ executionArn });

    const lastFailedEvent = lastFailedEventStep(events);
    if (!lastFailedEvent) {
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
    const taskExitedEventOutput = JSON.parse(getTaskExitedEventOutput(failedStepExitedEvent) ?? '{}');
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

export const getCumulusMessageFromExecutionEvent = async (executionEvent: EventBridgeEvent<'Step Functions Execution Status Change', { [key: string]: string }>) => {
  let cumulusMessage;
  if (executionEvent.detail.status === 'RUNNING') {
    cumulusMessage = JSON.parse(executionEvent.detail.input);
  } else if (executionEvent.detail.status === 'SUCCEEDED') {
    cumulusMessage = JSON.parse(executionEvent.detail.output);
  } else {
    const inputMessage = JSON.parse(get(executionEvent, 'detail.input') ?? '{}');
    cumulusMessage = await getFailedExecutionMessage(inputMessage);
  }

  const fullCumulusMessage = (await pullStepFunctionEvent(
    cumulusMessage
  )) as Message.CumulusMessage;

  const workflowStatus = executionStatusToWorkflowStatus(
    executionEvent.detail.status as ExecutionStatus
  );
  set(fullCumulusMessage, 'meta.status', workflowStatus);

  set(
    fullCumulusMessage,
    'cumulus_meta.workflow_stop_time',
    executionEvent.detail.stopDate
  );

  return fullCumulusMessage;
};
