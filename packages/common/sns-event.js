const get = require('lodash.get');

const log = require('./log');

/**
 * Determine if event is an SNS event
 *
 * @param {Object} event - A Cloudwatch event object
 * @returns {boolean} - True if event is an SNS event
 */
const isSnsEvent = (event) => event.EventSource === 'aws:sns';

/**
 * Get message from SNS event.
 *
 * @param {var} event - SNS event
 * @param {any} [defaultValue] - Default value to use for message, if none exists.
 * @returns {any} - Message from SNS event
 */
const getSnsEventMessage = (event, defaultValue) => get(event, 'Sns.Message', defaultValue);

/**
 * Get message object from SNS event.
 *
 * @param {Object} event - SNS event
 * @returns {Object} - Message object from SNS event
 */
const getSnsEventMessageObject = (event) => {
  const message = getSnsEventMessage(event, '{}');
  try {
    return JSON.parse(message);
  } catch (e) {
    log.error(`Could not parse '${message}'`);
    return null;
  }
};

module.exports = {
  getSnsEventMessage,
  getSnsEventMessageObject,
  isSnsEvent
};
