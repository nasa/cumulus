import { Message } from '@cumulus/types';

interface PDR {
  name: string
  PANSent: boolean
  PANmessage: string
}

interface MessageWithPdr extends Message.CumulusMessage {
  payload: {
    pdr?: PDR
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
): PDR | undefined => message.payload?.pdr;

/**
 * Determine if message has a PDR.
 *
 * @param {MessageWithPdr} message - A workflow message object
 * @returns {boolean} true if message has a PDR
 *
 * @alias module:PDRs
 */
export const messageHasPdr = (
  message: MessageWithPdr
): boolean => getMessagePdr(message) !== undefined;

/**
 * Get the PAN sent status from a PDR, if any.
 *
 * @param {PDR} pdr - A PDR object
 * @returns {boolean} The PAN sent status
 *
 * @alias module:PDRs
 */
export const getPdrPANSent = (
  pdr: PDR
): boolean => pdr?.PANSent ?? false;

/**
 * Get the PAN message status from a PDR, if any.
 *
 * @param {PDR} pdr - A PDR object
 * @returns {string} The PAN message
 *
 * @alias module:PDRs
 */
export const getPdrPANMessage = (
  pdr: PDR
): string => pdr?.PANmessage ?? 'N/A';

/**
 * Get the PDR name from a workflow message, if any.
 *
 * @param {MessageWithPdr} message - A workflow message
 * @returns {string} The PDR name
 *
 * @alias module:PDRs
 */
export const getMessagePdrName = (
  message: MessageWithPdr
): string | undefined => getMessagePdr(message)?.name;
