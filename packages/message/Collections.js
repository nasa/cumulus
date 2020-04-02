'use strict';

/**
 * Utility functions for generating collection information or parsing collection information
 * from a Cumulus message
 *
 * @module Collections
 *
 * @example
 * const Collections = require('@cumulus/message/Collections');
 */

const get = require('lodash.get');

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
const getCollectionIdFromMessage = (message) =>
  constructCollectionId(
    get(message, 'meta.collection.name'), get(message, 'meta.collection.version')
  );

module.exports = {
  constructCollectionId,
  getCollectionIdFromMessage
};
