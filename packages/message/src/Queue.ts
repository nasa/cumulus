'use strict';

/**
 * Utility functions for parsing queue information from a Cumulus message
 * @module Queue
 *
 * @example
 * const Queue = require('@cumulus/message/Queue');
 */

import findKey from 'lodash/findKey';
import get from 'lodash/get';
import isNil from 'lodash/isNil';
import { Message } from '@cumulus/types';

/**
 * Get queue name by URL from execution message.
 *
 * @param {Message.CumulusMessage} message - An execution message
 * @param {string} queueUrl - An SQS queue URL
 * @returns {string|undefined} An SQS queue name or undefined
 *
 * @alias module:Queue
 */
export const getQueueNameByUrl = (
  message: Message.CumulusMessage,
  queueUrl: string
) => {
  const queues = get(message, 'meta.queues', {});
  return findKey(queues, (value) => value === queueUrl);
};

/**
 * Get the queue name from a workflow message.
 *
 * @param {Message.CumulusMessage} message - A workflow message object
 * @returns {string} A queue name
 * @throws {Error} if no queue name in the message
 *
 * @alias module:Queue
 */
export const getQueueName = (message: Message.CumulusMessage) => {
  const queueName = get(message, 'cumulus_meta.queueName');
  if (isNil(queueName)) {
    throw new Error('cumulus_meta.queueName not set in message');
  }
  return queueName;
};

export const getQueueArn = (message: Message.CumulusMessage) => {
  const queueName = get(message, 'cumulus_meta.queueArn');
  if (isNil(queueName)) {
    throw new Error('cumulus_meta.queueArn not set in message');
  }
  return queueName;
};

/**
 * Get the maximum executions for a queue.
 *
 * @param {Message.CumulusMessage} message - A workflow message object
 * @param {string} queueName - A queue name
 * @returns {number} Count of the maximum executions for the queue
 * @throws {Error} if no maximum executions can be found
 *
 * @alias module:Queue
 */
export const getMaximumExecutions = (
  message: Message.CumulusMessage,
  queueName: string
) => {
  const maxExecutions = get(message, `meta.queueExecutionLimits.${queueName}`);
  if (isNil(maxExecutions)) {
    throw new Error(`Could not determine maximum executions for queue ${queueName}`);
  }
  return maxExecutions;
};

/**
 * Determine if there is a queue and queue execution limit in the message.
 *
 * @param {Message.CumulusMessage} message - A workflow message object
 * @returns {boolean} True if there is a queue and execution limit.
 *
 * @alias module:Queue
 */
export const hasQueueAndExecutionLimit = (message: Message.CumulusMessage) => {
  try {
    const queueName = getQueueName(message);
    getMaximumExecutions(message, queueName);
  } catch (error) {
    return false;
  }
  return true;
};
