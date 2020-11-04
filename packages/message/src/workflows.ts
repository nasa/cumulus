import { Message } from '@cumulus/types';

type MessageWithOptionalStatus = Message.CumulusMessage & {
  meta: {
    status?: string
  }
};

/**
 * Get the status workflow message, if any.
 *
 * @param {MessageWithOptionalStatus} message - A workflow message object
 * @returns {undefined|string} The workflow status
 *
 * @alias module:workflows
 */
export const getMetaStatus = (
  message: MessageWithOptionalStatus
): string | undefined => message.meta?.status;
