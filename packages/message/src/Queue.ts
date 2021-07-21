'use strict';

/**
 * Utility functions for parsing queue information from a Cumulus message
 * @module Queue
 *
 * @example
 * const Queue = require('@cumulus/message/Queue');
 */

import isNil from 'lodash/isNil';
import { Message } from '@cumulus/types';

type MessageWithQueueInfo = Message.CumulusMessage & {
  cumulus_meta: {
    queueUrl: string
  }
};

/**
 * Get the queue URL from a workflow message.
 *
 * @param {MessageWithQueueInfo} message - A workflow message object
 * @returns {string} A queue URL
 *
 * @alias module:Queue
 */
export const getQueueUrl = (message: MessageWithQueueInfo): string => {
  const queueUrl = message.cumulus_meta.queueUrl;
  if (isNil(queueUrl)) {
    throw new Error('Could not find queue URL at cumulus_meta.queueUrl in message');
  }
  return queueUrl;
};

/**
 * Get the maximum executions for a queue.
 *
 * @param {Message.CumulusMessage} message - A workflow message object
 * @param {string} queueUrl - A queue URL
 * @returns {number} Count of the maximum executions for the queue
 * @throws {Error} if no maximum executions can be found
 *
 * @alias module:Queue
 */
export const getMaximumExecutions = (
  message: Message.CumulusMessage,
  queueUrl: string
): number => {
  const maxExecutions = message.cumulus_meta.queueExecutionLimits?.[queueUrl];
  if (isNil(maxExecutions)) {
    throw new Error(`Could not determine maximum executions for queue ${queueUrl}`);
  }
  return maxExecutions;
};

/**
 * Determine if there is a queue and queue execution limit in the message.
 *
 * @param {MessageWithQueueInfo} message - A workflow message object
 * @returns {boolean} True if there is a queue and execution limit.
 *
 * @alias module:Queue
 */
export const hasQueueAndExecutionLimit = (
  message: MessageWithQueueInfo
): boolean => {
  try {
    const queueUrl = getQueueUrl(message);
    getMaximumExecutions(message, queueUrl);
  } catch (error) {
    return false;
  }
  return true;
};
