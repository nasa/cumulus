import { Message } from '@cumulus/types';

type MessageWithStatus = Message.CumulusMessage & {
  meta: {
    status?: string
  }
};

/**
 * Get the status workflow message, if any.
 *
 * @param {MessageWithStatus} message - A workflow message object
 * @returns {undefined|string} The workflow status
 *
 * @alias module:workflows
 */
export const getWorkflowStatus = (
  message: MessageWithStatus
): string | undefined => message.meta?.status;
