import * as log from './log';

type SnsEvent = {
  Sns?: {
    Message?: string
  }
};

/**
 * Determine if event is an SNS event
 *
 * @param {Object} event - A Cloudwatch event object
 * @returns {boolean} - True if event is an SNS event
 */
export const isSnsEvent = (event: {EventSource?: string}) =>
  event.EventSource === 'aws:sns';

/**
 * Get message from SNS event.
 *
 * @param {Object} event - SNS event
 * @param {any} [defaultValue] - Default value to use for message, if none exists.
 * @returns {any} - Message from SNS event
 */
const getSnsEventMessage = (event: SnsEvent, defaultValue: string) =>
  event?.Sns?.Message ?? defaultValue;

/**
 * Get message object from SNS event.
 *
 * @param {Object} event - SNS event
 * @returns {Object} - Message object from SNS event
 */
export const getSnsEventMessageObject = (event: SnsEvent) => {
  const message = getSnsEventMessage(event, '{}');
  try {
    return JSON.parse(message);
  } catch (error) {
    log.error(`Could not parse '${message}'`);
    return undefined;
  }
};
