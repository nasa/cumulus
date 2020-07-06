'use strict';

const { invokeApi } = require('./cumulusApiClient');

/**
 * Fetch a workflow from the Cumulus API
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {string} params.workflowName
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                       that takes a prefix / user payload.  Defaults
 *                                       to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - promise that resolves to the output
 *                                       of the API lambda
 */
const getWorkflow = ({ prefix, workflowName, callback = invokeApi }) =>
  callback({
    prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/workflows/${workflowName}`
    }
  });

/**
 * Fetch a list of workflows from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @returns {Promise<Object>} - the list of workflows fetched by the API
 */
const getWorkflows = async ({ prefix, callback = invokeApi }) => callback({
  prefix: prefix,
  payload: {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    path: '/workflows'
  }
});

module.exports = {
  getWorkflow,
  getWorkflows
};
