//@ts-check
import { EventBridgeEvent } from 'aws-lambda';
export type StepFunctionEventBridgeEvent = EventBridgeEvent<'Step Functions Execution Status Change', { [key: string]: string }>;

/**
 * Bare check for EventBridge shape
 *
 * @param {{ [key: string]: any }} event
 * @returns {event is EventBridgeEvent}
 */
export const isEventBridgeEvent = (event: Object): event is StepFunctionEventBridgeEvent => (
  event instanceof Object
  && 'detail' in event
);
