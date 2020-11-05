import { Message } from '@cumulus/types';

interface PDR {
  name: string
  PANSent: boolean
  PANmessage: string
}

interface MessageWithOptionalPayloadPdr extends Message.CumulusMessage {
  payload: {
    pdr?: PDR
  }
}

/**
 * Get the PDR object from a workflow message, if any.
 *
 * @param {MessageWithOptionalPayloadPdr} message - A workflow message object
 * @returns {undefined|Object} The PDR object
 *
 * @alias module:PDRs
 */
export const getMessagePdr = (
  message: MessageWithOptionalPayloadPdr
): PDR | undefined => message.payload?.pdr;

/**
 * Determine if message has a PDR.
 *
 * @param {MessageWithOptionalPayloadPdr} message - A workflow message object
 * @returns {boolean} true if message has a PDR
 *
 * @alias module:PDRs
 */
export const messageHasPdr = (
  message: MessageWithOptionalPayloadPdr
): boolean => getMessagePdr(message) !== undefined;

/**
 * Get the PAN sent status from a workflow message, if any.
 *
 * @param {MessageWithOptionalPayloadPdr} message - A workflow message
 * @returns {boolean} The PAN sent status
 *
 * @alias module:PDRs
 */
export const getMessagePdrPANSent = (
  message: MessageWithOptionalPayloadPdr
): boolean => getMessagePdr(message)?.PANSent ?? false;

/**
 * Get the PAN message status from a workflow message, if any.
 *
 * @param {MessageWithOptionalPayloadPdr} message - A workflow message
 * @returns {string} The PAN message
 *
 * @alias module:PDRs
 */
export const getMessagePdrPANMessage = (
  message: MessageWithOptionalPayloadPdr
): string => getMessagePdr(message)?.PANmessage ?? 'N/A';

/**
 * Get the PDR name from a workflow message, if any.
 *
 * @param {MessageWithOptionalPayloadPdr} message - A workflow message
 * @returns {string} The PDR name
 *
 * @alias module:PDRs
 */
export const getMessagePdrName = (
  message: MessageWithOptionalPayloadPdr
): string | undefined => getMessagePdr(message)?.name;
