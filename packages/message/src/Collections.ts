'use strict';

import get from 'lodash/get';
import { Message } from '@cumulus/types';

/**
 * Utility functions for generating collection information or parsing collection information
 * from a Cumulus message
 *
 * @module Collections
 *
 * @example
 * const Collections = require('@cumulus/message/Collections');
 */

/**
 * Returns the collection ID.
 *
 * @param {string} name - collection name
 * @param {string} version - collection version
 * @returns {string} collectionId
 *
 * @alias module:Collections
 */
export const constructCollectionId = (name: string, version: string) =>
  `${name}___${version}`;

/**
 * Get collection ID from execution message.
 *
 * @param {Message.CumulusMessage} message - An execution message
 * @returns {string | undefined} - A collection ID or undefined if
 *                                 message.meta.collection isn't
 *                                 present
 *
 * @alias module:Collections
 */
export const getCollectionIdFromMessage = (
  message: Message.CumulusMessage
) => {
  const collectionName = get(message, 'meta.collection.name');
  const collectionVersion = get(message, 'meta.collection.version');
  if (!collectionName || !collectionVersion) {
    return undefined;
  }
  return constructCollectionId(collectionName, collectionVersion);
};
