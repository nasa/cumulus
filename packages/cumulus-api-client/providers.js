'use strict';

const { invokeApi } = require('./cumulusApiClient');


// TODO: Make all of these paramaterized in code
/**
 * Create a provider via the API
 *
 * @param {Object} params          - params
 * @param {string} params.prefix   - the prefix configured for the stack
 * @param {string} params.provider - provider object
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>}      - promise that resolves to the output of the callback
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
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {string} params.providerId - a provider id
 * @param {Object} params.callback   - function to invoke the api lambda
 *                                     that takes a prefix / user payload
 * @returns {Promise<Object>}        - promise that resolves to the output
 *                                     of the callback
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
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {string} params.providerId - a provider id
 * @param {Object} params.callback   - function to invoke the api lambda
 *                                     that takes a prefix / user payload
 * @returns {Promise<Object>}        - promise that resolves to the output
 *                                     of the API lambda
 */
const getProvider = ({ prefix, providerId, callback = invokeApi }) => callback({
  prefix,
  payload: {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    path: `/providers/${providerId}`
  }
}); //TODO  why .then(({ body }) => JSON.parse(body)); ?

module.exports = {
  createProvider,
  deleteProvider,
  getProvider
};
