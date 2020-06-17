'use strict';

const get = require('lodash/get');
const { CumulusMessageError } = require('./errors');

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
function constructCollectionId(name, version) {
  return `${name}___${version}`;
}

/**
 * Get collection ID from execution message.
 *
 * @param {Object} message - An execution message
 * @returns {string} - A collection ID
 *
 * @alias module:Collections
 */
const getCollectionIdFromMessage = (message) => {
  const collectionName = get(message, 'meta.collection.name');
  const collectionVersion = get(message, 'meta.collection.version');
  if (!collectionName && !collectionVersion) {
    throw new CumulusMessageError(`Collection name and version missing from message meta: ${JSON.stringify(message.meta)}`);
  }
  return constructCollectionId(collectionName, collectionVersion);
};
module.exports = {
  constructCollectionId,
  getCollectionIdFromMessage
};
