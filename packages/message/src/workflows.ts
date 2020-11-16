import { Message } from '@cumulus/types';

type MessageWithOptionalStatus = Message.CumulusMessage & {
  meta: {
    status?: Message.WorkflowStatus
  }
};

/**
 * Get the status workflow message, if any.
 *
 * @param {MessageWithOptionalStatus} message - A workflow message object
 * @returns {Message.WorkflowStatus|undefined} The workflow status
 *
 * @alias module:workflows
 */
export const getMetaStatus = (
  message: MessageWithOptionalStatus
): Message.WorkflowStatus | undefined => message.meta?.status;
