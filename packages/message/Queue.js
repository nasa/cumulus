'use strict';

/**
 * Utility functions for parsing queue information from a Cumulus message
 * @module Queue
 *
 * @example
 * const Queue = require('@cumulus/message/Queue');
 */

const findKey = require('lodash/findKey');
const get = require('lodash/get');
const isNil = require('lodash/isNil');

/**
 * Get queue name by URL from execution message.
 *
 * @param {Object} message - An execution message
 * @param {string} queueUrl - An SQS queue URL
 * @returns {string} An SQS queue name
 *
 * @alias module:Queue
 */
const getQueueNameByUrl = (message, queueUrl) => {
  const queues = get(message, 'meta.queues', {});
  return findKey(queues, (value) => value === queueUrl);
};

/**
 * Get the queue name from a workflow message.
 *
 * @param {Object} message - A workflow message object
 * @returns {string} A queue name
 *
 * @alias module:Queue
 */
const getQueueName = (message) => {
  const queueName = get(message, 'cumulus_meta.queueName');
  if (isNil(queueName)) {
    throw new Error('cumulus_meta.queueName not set in message');
  }
  return queueName;
};

/**
 * Get the maximum executions for a queue.
 *
 * @param {Object} message - A workflow message object
 * @param {string} queueName - A queue name
 * @returns {number} Count of the maximum executions for the queue
 *
 * @alias module:Queue
 */
const getMaximumExecutions = (message, queueName) => {
  const maxExecutions = get(message, `meta.queueExecutionLimits.${queueName}`);
  if (isNil(maxExecutions)) {
    throw new Error(`Could not determine maximum executions for queue ${queueName}`);
  }
  return maxExecutions;
};

/**
 * Determine if there is a queue and queue execution limit in the message.
 *
 * @param {Object} message - A workflow message object
 * @returns {boolean} True if there is a queue and execution limit.
 *
 * @alias module:Queue
 */
const hasQueueAndExecutionLimit = (message) => {
  try {
    const queueName = getQueueName(message);
    getMaximumExecutions(message, queueName);
  } catch (err) {
    return false;
  }
  return true;
};

module.exports = {
  getQueueNameByUrl,
  getQueueName,
  getMaximumExecutions,
  hasQueueAndExecutionLimit
};
