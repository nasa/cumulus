'use strict';

const { invokeApi } = require('./cumulusApiClient');

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
const createCollection = async ({ prefix, collection, callback = invokeApi }) => callback({
  prefix,
  payload: {
    httpMethod: 'POST',
    resource: '/{proxy+}',
    headers: { 'Content-Type': 'application/json' },
    path: '/collections',
    body: JSON.stringify(collection)
  }
});

/**
 * DELETE /collections/{collectionName}/{collectionVersion}
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
const deleteCollection = async ({
  prefix, collectionName, collectionVersion, callback = invokeApi
}) => callback({
  prefix,
  payload: {
    httpMethod: 'DELETE',
    resource: '/{proxy+}',
    path: `/collections/${collectionName}/${collectionVersion}`
  }
});

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
const getCollection = async ({
  prefix, collectionName, collectionVersion, callback = invokeApi
}) => {
  const returnedCollection = await callback({
    prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/collections/${collectionName}/${collectionVersion}`
    }
  });
  return JSON.parse(returnedCollection.body);
};

/**
 * Get a list of collection from Cumulus via the API lambda
 * GET /collections
 *
 * @param {Object} params                     - params
 * @param {string} params.prefix              - the prefix configured for the stack
 * @param {Function} params.callback          - async function to invoke the api lambda
 *                                              that takes a prefix / user payload.  Defaults
 *                                              to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}                 - the response from the callback
 */
const getCollections = async ({
  prefix, callback = invokeApi
}) => callback({
  prefix,
  payload: {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    path: '/collections/'
  }
});

module.exports = {
  createCollection,
  deleteCollection,
  getCollection,
  getCollections
};
