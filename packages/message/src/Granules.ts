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
import pick from 'lodash/pick';

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
 * Get selective cnm fields from execution message
 *
 * @param {Message.CumulusMessage} message - An execution message
 * @returns {Object|undefined} object with cnm message fields
 *
 * @alias module:Granules
 */
export const getMessageCnm = (
  message: Message.CumulusMessage
): object | undefined => {
  const fields = ['identifier', 'submissionTime', 'receivedTime', 'processCompleteTime'];
  const cnm = get(message, 'meta.cnmResponse') || get(message, 'meta.cnm');
  return cnm ? pick(cnm, fields) : cnm;
};
