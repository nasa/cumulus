import { Message } from '@cumulus/types';

export interface MessageWithPdr extends Message.CumulusMessage {
  payload: {
    pdr?: {
      name: string
      PANSent: boolean
      PANmessage: string
    }
  }
}

/**
 * Get the PDR object from a workflow message, if any.
 *
 * @param {MessageWithPdr} message - A workflow message object
 * @returns {undefined|Object} The PDR object
 *
 * @alias module:PDRs
 */
export const getMessagePdr = (
  message: MessageWithPdr
): object | undefined => message.payload?.pdr;

/**
 * Get the PDR PAN sent status from a workflow message, if any.
 *
 * @param {MessageWithPdr} message - A workflow message object
 * @returns {boolean} The PAN sent status
 *
 * @alias module:PDRs
 */
export const getMessagePdrPANSent = (
  message: MessageWithPdr
): boolean => message.payload.pdr?.PANSent ?? false;

/**
 * Get the PDR PAN message status from a workflow message, if any.
 *
 * @param {MessageWithPdr} message - A workflow message object
 * @returns {string} The PDR object
 *
 * @alias module:PDRs
 */
export const getMessagePdrPANMessage = (
  message: MessageWithPdr
): string | undefined => message.payload.pdr?.PANmessage ?? 'N/A';
