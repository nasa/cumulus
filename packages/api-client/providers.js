'use strict';

const { invokeApi } = require('./cumulusApiClient');


/**
 * Create a provider via the API
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {string} params.provider   - provider object
 * @param {Function} params.callback - function to invoke the api lambda
 *                                     that takes a prefix / user payload
 * @returns {Promise<Object>}        - promise that resolves to the output of the callback
 */
const createProvider = ({ prefix, provider, callback = invokeApi }) => callback({
  prefix,
  payload: {
    httpMethod: 'POST',
    resource: '/{proxy+}',
    headers: { 'Content-Type': 'application/json' },
    path: '/providers',
    body: JSON.stringify(provider)
  }
});

/**
 * Delete a provider from the Cumulus API
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {string} params.providerId   - a provider id
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                       that takes a prefix / user payload.  Defaults
 *                                       to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - promise that resolves to the output
 *                                       of the callback
 */
const deleteProvider = ({ prefix, providerId, callback = invokeApi }) => callback({
  prefix,
  payload: {
    httpMethod: 'DELETE',
    resource: '/{proxy+}',
    path: `/providers/${providerId}`
  }
});

/**
 * Fetch a provider from the Cumulus API
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {string} params.providerId   - a provider id
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                       that takes a prefix / user payload.  Defaults
 *                                       to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - promise that resolves to the output
 *                                       of the API lambda
 */
const getProvider = ({ prefix, providerId, callback = invokeApi }) => callback({
  prefix,
  payload: {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    path: `/providers/${providerId}`
  }
});


/**
 * Fetch a list of providers from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @returns {Promise<Object>} - the list of providers fetched by the API
 */
const getProviders = async ({ prefix, callback = invokeApi }) => callback({
  prefix: prefix,
  payload: {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    path: '/providers'
  }
});

module.exports = {
  createProvider,
  deleteProvider,
  getProvider,
  getProviders
};
