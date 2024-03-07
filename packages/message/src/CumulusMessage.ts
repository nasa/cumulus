import { Message } from '@cumulus/types';

/**
 * Bare check for CumulusMessage Shape
 */
export const isCumulusMessageLike = (message: any): message is Message.CumulusMessage => (
  message instanceof Object
  && 'cumulus_meta' in message
);
