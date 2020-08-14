'use strict';

const { deprecate } = require('@cumulus/common/util');
const collectionsApi = require('@cumulus/api-client/collections');

/**
 * POST /collections
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {Object} params.collection   - collection object to add to the database
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                     that takes a prefix / user payload.  Defaults
 *                                     to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - the response from the callback
 */
const createCollection = (params) => {
  deprecate('@cumulus/integration-tests/collections.createCollection', '1.21.0', '@cumulus/api-client/collections.createCollection');
  return collectionsApi.getGranule(params);
};

/*
* DELETE /collections/{vollectionName}/{collectionVersion}
*
* @param {Object} params                     - params
* @param {string} params.prefix              - the prefix configured for the stack
* @param {Object} params.collectionVersion   - name of collection to delete
* @param {Object} params.collectionName      - version of collection to delete
* @param {Function} params.callback          - async function to invoke the api lambda
*                                            that takes a prefix / user payload.  Defaults
*                                            to cumulusApiClient.invokeApi
* @returns {Promise<Object>}                 - the response from the callback
*/
const deleteCollection = (params) => {
  deprecate('@cumulus/integration-tests/collections.deleteCollection', '1.21.0', '@cumulus/api-client/collections.deleteCollection');
  return collectionsApi.deleteCollection(params);
};

/**
 * Get a collection from Cumulus via the API lambda
 * GET /collections/{vollectionName}/{collectionVersion}
 *
 * @param {Object} params                     - params
 * @param {string} params.prefix              - the prefix configured for the stack
 * @param {Object} params.collectionVersion   - name of collection to get
 * @param {Object} params.collectionName      - version of collection to get
 * @param {Function} params.callback          - async function to invoke the api lambda
 *                                              that takes a prefix / user payload.  Defaults
 *                                              to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}                 - the response from the callback
 */
const getCollection = (params) => {
  deprecate('@cumulus/integration-tests/collections.getCollection', '1.21.0', '@cumulus/api-client/collections.getCollection');
  return collectionsApi.getCollection(params);
};

module.exports = {
  createCollection,
  deleteCollection,
  getCollection,
};
