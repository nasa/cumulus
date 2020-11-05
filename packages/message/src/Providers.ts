import { Message } from '@cumulus/types';

type MessageWithProvider = Message.CumulusMessage & {
  meta: {
    provider?: {
      id: string
    }
  }
};

/**
 * Get the provider ID from a workflow message, if any.
 *
 * @param {MessageWithProvider} message - A workflow message object
 * @returns {undefined|string} The provider ID
 *
 * @alias module:Providers
 */
export const getMessageProviderId = (
  message: MessageWithProvider
): string | undefined => message.meta?.provider?.id;
