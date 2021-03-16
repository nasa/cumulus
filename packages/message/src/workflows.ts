import { CumulusMessageError } from '@cumulus/errors';
import { Message } from '@cumulus/types';

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
