'use strict';

/**
 * Utility functions for parsing granule information from a Cumulus message
 * @module Granules
 *
 * @example
 * const Granules = require('@cumulus/message/Granules');
 */

const get = require('lodash/get');

/**
 * Get granules from execution message.
 *
 * @param {Object} message - An execution message
 * @returns {Array<Object>|undefined} An array of granule objects, or
 *   undefined if `message.payload.granules` is not set
 *
 * @alias module:Granules
 */
const getMessageGranules = (message) => get(message, 'payload.granules');

module.exports = {
  getMessageGranules
};
