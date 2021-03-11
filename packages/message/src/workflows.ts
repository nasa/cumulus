import isNil from 'lodash/isNil';
import { Message } from '@cumulus/types';
import { CumulusMessageError } from '@cumulus/errors';

type MessageWithOptionalWorkflowInfo = Message.CumulusMessage & {
  cumulus_meta: {
    workflow_start_time?: number
    workflow_stop_time?: number
  }
  meta: {
    status?: Message.WorkflowStatus
    workflow_tasks?: object
  }
};

/**
 * Get the status of a workflow message, if any.
 *
 * @param {MessageWithOptionalStatus} message - A workflow message object
 * @returns {Message.WorkflowStatus|undefined} The workflow status
 *
 * @alias module:workflows
 */
export const getMetaStatus = (
  message: MessageWithOptionalWorkflowInfo
): Message.WorkflowStatus | undefined => message.meta?.status;

/**
 * Get the workflow tasks in a workflow message, if any.
 *
 * @param {MessageWithOptionalWorkflowInfo} message - A workflow message object
 * @returns {Object|undefined} A map of the workflow tasks
 *
 * @alias module:workflows
 */
export const getMessageWorkflowTasks = (
  message: MessageWithOptionalWorkflowInfo
): object | undefined => message.meta?.workflow_tasks;

/**
 * Get the workflow start time, if any.
 *
 * @param {MessageWithOptionalWorkflowInfo} message - A workflow message object
 * @returns {number|undefined} The workflow start time, in milliseconds
 *
 * @alias module:workflows
 */
export const getMessageWorkflowStartTime = (
  message: MessageWithOptionalWorkflowInfo
): number => {
  if (!message.cumulus_meta.workflow_start_time) {
    throw new CumulusMessageError('getMessageWorkflowStartTime on a message without a workflow_start_time');
  }
  return message.cumulus_meta.workflow_start_time;
};
/**
 * Get the workflow stop time, if any.
 *
 * @param {MessageWithOptionalWorkflowInfo} message - A workflow message object
 * @returns {number|undefined} The workflow stop time, in milliseconds
 *
 * @alias module:workflows
 */
export const getMessageWorkflowStopTime = (
  message: MessageWithOptionalWorkflowInfo
): number | undefined => message.cumulus_meta?.workflow_stop_time;

/**
 * Get the workflow name, if any.
 *
 * @param {Message.CumulusMessage} message - A workflow message object
 * @returns {string|undefined} The workflow name
 *
 * @alias module:workflows
 */
export const getMessageWorkflowName = (
  message: Message.CumulusMessage
): string | undefined => message.meta?.workflow_name;

/**
 * Get the workflow duration.
 *
 * @param {number} startTime - Workflow start time (as timestamp in ms)
 * @param {number} [stopTime] - Time to use for measuring duration (as timestamp in ms)
 * @returns {number} The workflow duration (in seconds)
 *
 * @alias module:workflows
 */
export const getWorkflowDuration = (
  startTime: number,
  stopTime?: number
): number => (isNil(stopTime) ? 0 : (stopTime - startTime) / 1000);
