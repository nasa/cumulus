//@ts-check

/**
 * Bare check for EventBridge shape
 *
 * @param {{ [key: string]: any }} event
 * @returns {message is EventBridgeEvent}
 */
export const isEventBridgeEvent = (event: Object): boolean => (
  event instanceof Object
  && 'detail' in event
);
