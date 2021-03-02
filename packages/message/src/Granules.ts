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
import { CumulusMessageError } from '@cumulus/errors';

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

/**
* Get granule created_at time
* @param   {Message.CumulusMessage} message - An execution message
* @returns {ReturnValueDataTypeHere} Returns number representing created_at
* granule time
* @throws {Error} if there's no start time
*/
export const getGranuleCreatedAt = (
  message: Message.CumulusMessage
): undefined | number => {
  const createdAtTime = get(message, 'cumulus_meta.workflow_start_time');
  if (!createdAtTime) {
    throw new CumulusMessageError('Message did not contain workflow start time');
  }
  return createdAtTime;
};
