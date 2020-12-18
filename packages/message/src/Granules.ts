'use strict';

/**
 * Utility functions for parsing granule information from a Cumulus message
 * @module Granules
 *
 * @example
 * const Granules = require('@cumulus/message/Granules');
 */

import get from 'lodash/get';
import { Message } from '@cumulus/types';

/**
 * Get granules from execution message.
 *
 * @param {Message.CumulusMessage} message - An execution message
 * @returns {Array<Object>|undefined} An array of granule objects, or
 *   undefined if `message.payload.granules` is not set
 *
 * @alias module:Granules
 */
export const getMessageGranules = (
  message: Message.CumulusMessage
): unknown[] | undefined => get(message, 'payload.granules');
