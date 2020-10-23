'use strict';

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

type CollectionInfo = {
  name: string
  version: string
};

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

export const getCollectionNameFromMessage = (
  message: Message.CumulusMessage
): string | undefined => message.meta?.collection?.name;

export const getCollectionVersionFromMessage = (
  message: Message.CumulusMessage
): string | undefined => message.meta?.collection?.version;

export const getCollectionInfoFromMessage = (
  message: Message.CumulusMessage
): CollectionInfo | undefined => {
  const name = getCollectionNameFromMessage(message);
  const version = getCollectionVersionFromMessage(message);
  if (!name || !version) {
    return undefined;
  }
  return {
    name,
    version,
  };
};

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
): string | undefined => {
  const collectionName = getCollectionNameFromMessage(message);
  const collectionVersion = getCollectionVersionFromMessage(message);
  if (!collectionName || !collectionVersion) {
    return undefined;
  }
  return constructCollectionId(collectionName, collectionVersion);
};
