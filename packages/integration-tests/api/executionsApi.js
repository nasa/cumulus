'use strict';

const { deprecate } = require('@cumulus/common/util');
const executionsApi = require('@cumulus/api-client/executions');


/**
 * Fetch an execution from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.arn - an execution arn
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>} - the execution fetched by the API
 */
const getExecution = async (params) => {
  deprecate('@cumulus/integration-tests/exeuctionsApi.getExecution', '1.20.0', '@cumulus/cumulus-api-client/ems.getExecution');
  return executionsApi.getExecution(params);
};

/**
 * Fetch a list of executions from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>} - the execution list fetched by the API
 */
const getExecutions = async (params) => {
  deprecate('@cumulus/integration-tests/exeuctionsApi.getExecutions', '1.20.0', '@cumulus/cumulus-api-client/executions.getExecutions');
  return executionsApi.getExecutions(params);
};


/**
 * get execution status from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.arn - an execution arn
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>} - the execution status fetched by the API
 */
async function getExecutionStatus(params) {
  deprecate('@cumulus/integration-tests/exeuctionsApi.getExecutionStatus', '1.20.0', '@cumulus/cumulus-api-client/executions.getExecutionStatus');
  return executionsApi.getExecutions(params);
}

module.exports = {
  getExecution,
  getExecutions,
  getExecutionStatus
};
