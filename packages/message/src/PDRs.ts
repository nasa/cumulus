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

interface MessageWithOptionalPdrStats extends Message.CumulusMessage {
  payload: {
    pdr: PDR
    failed?: unknown[]
    running?: unknown[]
    completed?: unknown[]
  }
}

interface PdrStats {
  processing: number
  completed: number
  failed: number
  total: number
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

/**
 * Get the number of running executions for a PDR, if any.
 *
 * @param {MessageWithOptionalPdrStats} message - A workflow message
 * @returns {number} Number of running executions
 *
 * @alias module:PDRs
 */
export const getMessagePdrRunningExecutions = (
  message: MessageWithOptionalPdrStats
): number => (message.payload.running ?? []).length;

/**
 * Get the number of completed executions for a PDR, if any.
 *
 * @param {MessageWithOptionalPdrStats} message - A workflow message
 * @returns {number} Number of completed executions
 *
 * @alias module:PDRs
 */
export const getMessagePdrCompletedExecutions = (
  message: MessageWithOptionalPdrStats
): number => (message.payload.completed ?? []).length;

/**
 * Get the number of failed executions for a PDR, if any.
 *
 * @param {MessageWithOptionalPdrStats} message - A workflow message
 * @returns {number} Number of failed executions
 *
 * @alias module:PDRs
 */
export const getMessagePdrFailedExecutions = (
  message: MessageWithOptionalPdrStats
): number => (message.payload.failed ?? []).length;

/**
 * Get the PDR stats from a workflow message, if any.
 *
 * @param {MessageWithOptionalPayloadPdr} message - A workflow message
 * @returns {PdrStats}
 *   Object tracking the status of executions triggered by the PDR
 *
 * @alias module:PDRs
 */
export const getMessagePdrStats = (
  message: MessageWithOptionalPdrStats
): PdrStats => {
  const processing = getMessagePdrRunningExecutions(message);
  const completed = getMessagePdrCompletedExecutions(message);
  const failed = getMessagePdrFailedExecutions(message);
  const stats = {
    processing,
    completed,
    failed,
    total: processing + completed + failed,
  };
  return stats;
};

/**
 * Get the percent completion of PDR executions
 *
 * @param {PdrStats} stats - Stats tracking PDR executions
 * @returns {number} Percent completion of PDR executions
 *
 * @alias module:PDRs
 */
export const getPdrPercentCompletion = (
  stats: PdrStats
): number => {
  let progress = 0;
  if (stats.processing > 0 && stats.total > 0) {
    progress = ((stats.total - stats.processing) / stats.total) * 100;
  } else if (stats.processing === 0 && stats.total > 0) {
    progress = 100;
  }
  return progress;
};
