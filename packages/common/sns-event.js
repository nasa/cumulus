const get = require('lodash.get');

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
const getSnsEventMessageObject = (event) => JSON.parse(getSnsEventMessage(event, '{}'));

module.exports = {
  getSnsEventMessage,
  getSnsEventMessageObject,
  isSnsEvent
};
