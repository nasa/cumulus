import { Message } from '@cumulus/types';

/**
 * Get the async operation ID from a workflow message, if any.
 *
 * @param {Message.CumulusMessage} message - A workflow message object
 * @returns {undefined|string} The async operation ID
 *
 * @alias module:Executions
 */
export const getMessageAsyncOperationId = (
  message: Message.CumulusMessage
): string | undefined => message.cumulus_meta?.asyncOperationId;
