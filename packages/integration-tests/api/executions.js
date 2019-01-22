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
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/executions/${arn}`
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
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/executions'
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
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/executions/status/${arn}`
    }
  });
}

module.exports = {
  getExecution,
  getExecutions,
  getExecutionStatus
};
