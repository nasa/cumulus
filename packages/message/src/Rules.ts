'use strict';

import { Message } from '@cumulus/types';

/**
 * Utility functions for generating collection information or parsing collection information
 * from a Cumulus message
 *
 * @module Rules
 *
 * @example
 * const Rules = require('@cumulus/message/Rules');
 */

type MessageWithRules = Message.CumulusMessage & {
  payload: {
    rules?: object[]
  }
};

/**
 * Get Rule from payload?.rule of a workflow message.
 *
 * @param {MessageWithRule} message - A workflow message
 * @returns {Array<Object>|undefined} An array of rule objects, or
 *   undefined if `message.payload.rule` is not set
 *
 * @alias module:Rules
 */
export const getMessageRules = (
  message: MessageWithRules
): unknown[] => message.payload?.rules ?? [];
