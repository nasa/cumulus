import * as log from './log';
import { isOneOf } from './util';
import { AwsCloudWatchEvent } from './types';

/**
 * Determine if Cloudwatch event is a Step Function event
 *
 * @param {AwsCloudWatchEvent} event - A Cloudwatch event
 * @returns {boolean} True if event is a Step Function event
 */
export const isSfExecutionEvent = (event: AwsCloudWatchEvent) =>
  event.source === 'aws.states';

/**
 * Determine if Step Function is in a terminal state.
 *
 * @param {string} status - A Step Function execution status from a Cloudwatch event
 * @returns {boolean} True if Step Function is in terminal state.
 */
export const isTerminalSfStatus: (status: string) => boolean = isOneOf([
  'ABORTED',
  'SUCCEEDED',
  'FAILED',
  'TIMED_OUT',
]);

/**
 * Determine if Step Function is in a failed state.
 *
 * @param {Object} status - A Step Function execution status from a Cloudwatch event
 * @returns {boolean} True if Step Function is in failed state.
 */
export const isFailedSfStatus: (status: string) => boolean = isOneOf([
  'ABORTED',
  'FAILED',
  'TIMED_OUT',
]);

/**
 * Get Step Function status from Cloudwatch event.
 *
 * @param {AwsCloudWatchEvent} event - A Cloudwatch event
 * @returns {string|undefined} Step Function execution status
 */
export const getSfEventStatus = (event: AwsCloudWatchEvent) =>
  event?.detail?.status;

/**
 * Get the Step Function output message from a Cloudwatch Event
 *
 * @param {AwsCloudWatchEvent} event - A Cloudwatch event
 * @param {string} field - Field to pull from 'detail', i.e. 'input' or 'output'
 * @param {string} [defaultValue] - A default value for the message, if none exists
 * @returns {string|undefined} Output message from Step Function
 */
export const getSfEventDetailValue = (
  event: AwsCloudWatchEvent,
  field: 'input' | 'output',
  defaultValue?: string
) => event?.detail?.[field] ?? defaultValue;

/**
 * Get the Step Function output message from a Cloudwatch Event
 *
 * @param {Object} event - A Cloudwatch event
 * @param {string} messageSource - 'input' or 'output' from Step Function
 * @param {string} defaultValue - defaultValue to fetch if no event message object is found
 * @returns {unknown} Message object from Step Function
 */
export const getSfEventMessageObject = (
  event: AwsCloudWatchEvent,
  messageSource: 'input' | 'output',
  defaultValue: string
): unknown => {
  const message = getSfEventDetailValue(event, messageSource, defaultValue);

  if (message === undefined) {
    log.error('Unable to find message');
    return undefined;
  }

  try {
    return JSON.parse(message);
  } catch (error) {
    log.error(`Could not parse '${message}'`);
    return undefined;
  }
};
