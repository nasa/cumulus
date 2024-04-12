import { Message } from '@cumulus/types';
import { isCumulusMessageLike } from './CumulusMessage';
type MessageProvider = {
  id: string
  protocol: string
  host: string
  port?: number
};

export const isMessageProvider = (
  obj: any
): obj is MessageProvider => (
  obj instanceof Object
  // in testing instanceof String can return false for string literals
  && 'id' in obj && (typeof (obj.id) === 'string' || obj.id instanceof String)
  && 'protocol' in obj && (typeof (obj.protocol) === 'string' || obj.protocol instanceof String)
  && 'host' in obj && (typeof (obj.host) === 'string' || obj.host instanceof String)
  && ('port' in obj ? (typeof (obj.port) === 'number' || obj.port instanceof Number) : true)
);

type MessageWithProvider = Message.CumulusMessage & {
  meta: {
    provider?: MessageProvider
  }
};

export const isMessageWithProvider = (
  obj: any
): obj is MessageWithProvider => (
  isCumulusMessageLike(obj)
  && isMessageProvider(obj?.meta?.provider)
);
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
