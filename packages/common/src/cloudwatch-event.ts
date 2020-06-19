import get from 'lodash/get';
import * as log from './log';
import { isOneOf } from './util';

/**
 * Determine if Cloudwatch event is a Step Function event
 *
 * @param {Object} event - A Cloudwatch event
 * @returns {boolean} - True if event is a Step Function event
 */
export const isSfExecutionEvent = (event: { source?: string }) =>
  event.source === 'aws.states';

/**
 * Determine if Step Function is in a terminal state.
 *
 * @param {Object} status - A Step Function execution status from a Cloudwatch event
 * @returns {boolean} - True if Step Function is in terminal state.
 */
export const isTerminalSfStatus = isOneOf([
  'ABORTED',
  'SUCCEEDED',
  'FAILED',
  'TIMED_OUT'
]);

/**
 * Determine if Step Function is in a failed state.
 *
 * @param {Object} status - A Step Function execution status from a Cloudwatch event
 * @returns {boolean} - True if Step Function is in failed state.
 */
export const isFailedSfStatus = isOneOf([
  'ABORTED',
  'FAILED',
  'TIMED_OUT'
]);

/**
 * Get Step Function status from Cloudwatch event.
 *
 * @param {Object} event - A Cloudwatch event
 * @returns {string} - Step Function execution status
 */
export const getSfEventStatus = (
  event: {
    detail?: {
      status?: string
    }
  }
): string | undefined => get(event, 'detail.status');

/**
 * Get the Step Function output message from a Cloudwatch Event
 *
 * @param {Object} event - A Cloudwatch event
 * @param {string} field - Field to pull from 'detail', i.e. 'input' or 'output'
 * @param {any} [defaultValue] - A default value for the message, if none exists
 * @returns {any} - Output message from Step Function
 */
export const getSfEventDetailValue = (
  event: {
    detail?: {
      [key: string]: string
    }
  },
  field: string,
  defaultValue: string
): string => get(event, `detail.${field}`, defaultValue);

/**
 * Get the Step Function output message from a Cloudwatch Event
 *
 * @param {Object} event - A Cloudwatch event
 * @param {string} messageSource - 'input' or 'output' from Step Function
 * @param {string} defaultValue - defaultValue to fetch if no event message object is found
 * @returns {Object} - Message object from Step Function
 */
export const getSfEventMessageObject = (
  event: {
    detail?: {
      [key: string]: string
    }
  },
  messageSource: string,
  defaultValue: string
) => {
  const message = getSfEventDetailValue(event, messageSource, defaultValue);
  try {
    return JSON.parse(message);
  } catch (error) {
    log.error(`Could not parse '${message}'`);
    return undefined;
  }
};
