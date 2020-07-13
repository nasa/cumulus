'use strict';

const { invokeApi } = require('./cumulusApiClient');

/**
 * Get /asyncOperations/{asyncOperationId}
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {Object} params.asyncOperationId - the async operation id
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                     that takes a prefix / user payload.  Defaults
 *                                     to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - the response from the callback
 */
const getAsyncOperation = async ({ prefix, asyncOperationId, callback = invokeApi }) => callback({
  prefix,
  payload: {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    path: `/asyncOperations/${asyncOperationId}`
  }
});

module.exports = {
  getAsyncOperation
};
