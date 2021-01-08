'use strict';

/**
 * Utility functions for parsing granule information from a Cumulus message
 * @module Granules
 *
 * @example
 * const Granules = require('@cumulus/message/Granules');
 */

import { Message } from '@cumulus/types';
import { ApiGranule, GranuleStatus } from '@cumulus/types/api/granules';

interface MessageWithGranules extends Message.CumulusMessage {
  payload: {
    granules?: object[]
  }
}

/**
 * Get granules from payload?.granules of a workflow message.
 *
 * @param {MessageWithGranules} message - A workflow message
 * @returns {Array<Object>|undefined} An array of granule objects, or
 *   undefined if `message.payload.granules` is not set
 *
 * @alias module:Granules
 */
export const getMessageGranules = (
  message: MessageWithGranules
): unknown[] => message.payload?.granules ?? [];

/**
 * Determine the status of a granule.
 *
 * @param {ApiGranule} granule - A granule record
 * @returns {string} The granule status
 *
 * @alias module:Granules
 */
export const getGranuleStatus = (
  granule: ApiGranule
): Message.WorkflowStatus | GranuleStatus => granule.status;
