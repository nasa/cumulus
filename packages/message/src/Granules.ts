'use strict';

/**
 * Utility functions for parsing granule information from a Cumulus message
 * @module Granules
 *
 * @example
 * const Granules = require('@cumulus/message/Granules');
 */

import { Message } from '@cumulus/types';

interface MessageWithGranules extends Message.CumulusMessage {
  payload: {
    granules?: object[]
  }
}

/**
 * Get granules from a workflow message.
 *
 * @param {MessageWithGranules} message - A workflow message
 * @returns {Array<Object>|undefined} An array of granule objects, or
 *   undefined if `message.payload.granules` is not set
 *
 * @alias module:Granules
 */
export const getMessageGranules = (
  message: MessageWithGranules
): unknown[] | undefined => message.payload?.granules;

/**
 * Determine whether workflow message has granules.
 *
 * @param {MessageWithGranules} message - A workflow message
 * @returns {boolean} true if message has granules
 *
 * @alias module:Granules
 */
export const messageHasGranules = (
  message: MessageWithGranules
): boolean => getMessageGranules(message) !== undefined;
