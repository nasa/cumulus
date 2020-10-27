import { Message } from '@cumulus/types';

interface MessageWithStatus extends Message.CumulusMessage {
  meta: {
    status?: string
  }
}

/**
 * Get the status workflow message, if any.
 *
 * @param {MessageWithStatus} message - A workflow message object
 * @returns {undefined|string} The PDR object
 *
 * @alias module:PDRs
 */
export const getWorkflowStatus = (
  message: MessageWithStatus
): string | undefined => message.meta?.status;
