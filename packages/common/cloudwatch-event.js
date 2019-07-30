const get = require('lodash.get');

const { isOneOf } = require('./util');

/**
 * Determine if Cloudwatch event is a Step Function event
 *
 * @param {Object} event - A Cloudwatch event object
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
 * @param {Object} event - A Cloudwatch event object
 * @returns {string} - Step Function execution status
 */
const getSfEventStatus = (event) => get(event, 'detail.status');

/**
 * Get the Step Function output message from a Cloudwatch Event
 *
 * @param {Object} event - A Cloudwatch event object
 * @returns {Object} - Object of output from Step Function
 */
const getSfEventMessage = (event) => JSON.parse(get(event, 'detail.output', '{}'));

module.exports = {
  getSfEventMessage,
  getSfEventStatus,
  isSfExecutionEvent,
  isTerminalSfStatus
};
