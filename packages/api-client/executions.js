'use strict';

const { invokeApi } = require('./cumulusApiClient');

/**
 * Fetch an execution from the Cumulus API
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {string} params.arn        - an execution arn
 * @param {Function} params.callback - async function to invoke the api lambda
 *                                     that takes a prefix / user payload.  Defaults
 *                                     to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}        - the response from the API
 */
const getExecution = async ({ prefix, arn, callback = invokeApi }) =>
  // TODO What happens if the execution does not exist?
  callback({
    prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/executions/${arn}`
    }
  });

/**
 * Fetch a list of executions from the Cumulus API
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {Function} params.callback - async function to invoke the api lambda
 *                                     that takes a prefix / user payload.  Defaults
 *                                     to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}        - the execution list fetched by the API
 */
const getExecutions = async ({ prefix, callback = invokeApi }) => callback({
  prefix,
  payload: {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    path: '/executions'
  }
});

/**
 * get execution status from the Cumulus API
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {string} params.arn        - an execution arn
 * @param {Function} params.callback - async function to invoke the api lambda
 *                                     that takes a prefix / user payload.  Defaults
 *                                     to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}        - the execution status fetched by the API
 */
const getExecutionStatus = async ({ prefix, arn, callback = invokeApi }) => callback({
  prefix: prefix,
  payload: {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    path: `/executions/status/${arn}`
  }
});

module.exports = {
  getExecution,
  getExecutions,
  getExecutionStatus
};
