const get = require('lodash.get');

const { isOneOf } = require('./util');

/**
 * Determine if Cloudwatch event is a Step Function event
 *
 * @param {Object} event - A Cloudwatch event
 * @returns {boolean} - True if event is a Step Function event
 */
const isSfExecutionEvent = (event) => event.source === 'aws.states';

/**
 * Determine if Step Function is in a terminal state.
 *
 * @param {Object} status - A Step Function execution status from a Cloudwatch event
 * @returns {boolean} - True if Step Function is in terminal state.
 */
const isTerminalSfStatus = isOneOf([
  'ABORTED',
  'SUCCEEDED',
  'FAILED',
  'TIMED_OUT'
]);

/**
 * Get Step Function status from Cloudwatch event.
 *
 * @param {Object} event - A Cloudwatch event
 * @returns {string} - Step Function execution status
 */
const getSfEventStatus = (event) => get(event, 'detail.status');

/**
 * Get the Step Function output message from a Cloudwatch Event
 *
 * @param {Object} event - A Cloudwatch event
 * @param {any} [defaultValue] - A default value for the message, if none exists
 * @returns {any} - Output message from Step Function
 */
const getSfEventMessage = (event, defaultValue) => get(event, 'detail.output', defaultValue);

/**
 * Get the Step Function output message from a Cloudwatch Event
 *
 * @param {Object} event - A Cloudwatch event
 * @returns {Object} - Output message object from Step Function
 */
const getSfEventMessageObject = (event) => JSON.parse(getSfEventMessage(event, '{}'));

module.exports = {
  getSfEventMessage,
  getSfEventMessageObject,
  getSfEventStatus,
  isSfExecutionEvent,
  isTerminalSfStatus
};
