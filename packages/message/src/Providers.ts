import { Message } from '@cumulus/types';

type MessageProvider = {
  id: string
  protocol: string
  host: string
  port?: number
};

type MessageWithProvider = Message.CumulusMessage & {
  meta: {
    provider?: MessageProvider
  }
};

/**
 * Get the provider from a workflow message, if any.
 *
 * @param {MessageWithProvider} message - A workflow message object
 * @returns {MessageProvider|string} The provider object
 *
 * @alias module:Providers
 */
export const getMessageProvider = (
  message: MessageWithProvider
): MessageProvider | undefined => message.meta?.provider;

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
): string | undefined => getMessageProvider(message)?.id;
