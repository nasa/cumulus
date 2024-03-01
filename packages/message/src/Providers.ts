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
  && 'id' in obj && (obj.id instanceof String || typeof (obj.id) === 'string')
  && 'protocol' in obj && (obj.protocol instanceof String || typeof (obj.protocol) === 'string')
  && 'host' in obj && (obj.host instanceof String || typeof (obj.host) === 'string')
  && ('port' in obj ? (obj.port instanceof Number || typeof (obj.port) === 'number') : true)
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
  && 'meta' in obj
  && obj.meta instanceof Object
  && 'provider' in obj.meta && isMessageProvider(obj.meta.provider)
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
