'use strict';

const { callCumulusApi } = require('./api');

/**
 * Fetch an execution from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.arn - an execution arn
 * @returns {Promise<Object>} - the execution fetched by the API
 */
async function getExecution({ prefix, arn }) {
  return callCumulusApi({
    prefix: prefix,
    functionName: 'ApiExecutionsDefault',
    payload: {
      httpMethod: 'GET',
      resource: '/executions/{arn}',
      path: `executions/${arn}`,
      pathParameters: {
        arn: arn
      }
    }
  });
}

/**
 * Fetch a list of executions from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @returns {Promise<Object>} - the execution list fetched by the API
 */
async function getExecutions({ prefix }) {
  return callCumulusApi({
    prefix: prefix,
    functionName: 'ApiExecutionsDefault',
    payload: {
      httpMethod: 'GET',
      resource: '/executions',
      path: 'executions'
    }
  });
}


/**
 * get execution status from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.arn - an execution arn
 * @returns {Promise<Object>} - the execution status fetched by the API
 */
async function getExecutionStatus({ prefix, arn }) {
  return callCumulusApi({
    prefix: prefix,
    functionName: 'ApiExecutionStatusDefault',
    payload: {
      httpMethod: 'GET',
      resource: '/executions/status/{arn}',
      path: `executions/status/${arn}`,
      pathParameters: {
        arn: arn
      }
    }
  });
}

module.exports = {
  getExecution,
  getExecutions,
  getExecutionStatus
};
