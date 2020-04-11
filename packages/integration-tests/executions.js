'use strict';

const executionsApi = require('@cumulus/api-client/executions');
const get = require('lodash/get');
const isNil = require('lodash/isNil');
const pick = require('lodash/pick');
const pRetry = require('p-retry');

/**
 * Find the execution ARN matching the `matcher` function
 *
 * @param {string} prefix - the prefix configured for the stack
 * @param {Function} matcher - a predicate function that takes an execution and
 *   determines if this is the execution that is being searched for
 * @param {Object} [options]
 * @param {integer} [options.timeout] - the number of seconds to wait for a
 *   matching execution to be found
 * @returns {Promise<Object>} the matching execution
 */
const findExecutionArn = async (prefix, matcher, options = { timeout: 0 }) =>
  pRetry(
    async () => {
      let execution;

      try {
        const { body } = await executionsApi.getExecutions({ prefix });
        const executions = JSON.parse(body);
        execution = executions.results.find(matcher);
      } catch (err) {
        throw new pRetry.AbortError(err);
      }

      if (isNil(execution)) throw new Error('Not Found');

      return execution.arn;
    },
    {
      retries: options.timeout,
      maxTimeout: 1000
    }
  );

/**
 * Wait for an execution to be completed and return it
 *
 * @param {Object} params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.arn - an execution ARN
 * @param {Function} params.callback - an async function to invoke the api
 *   lambda that takes a prefix / user payload. Defaults to
 *   cumulusApiClient.invokeApifunction to invoke the api lambda
 * @param {integer} params.timeout - the number of seconds to wait for the
 *   execution to reach a terminal state. Defaults to 30
 * @returns {Promise<undefined>}
 */
const getCompletedExecution = async (params = {}) =>
  pRetry(
    async () => {
      // TODO Handle the case where the execution does not exist
      let execution;

      try {
        execution = await executionsApi.getExecution(
          pick(params, ['prefix', 'arn', 'callback'])
        );
      } catch (err) {
        throw new pRetry.AbortError(err);
      }

      if (execution.status === 'completed') return execution;

      if (execution.status === 'failed') {
        throw new pRetry.AbortError(
          new Error(`Execution ${params.arn} failed`)
        );
      }

      throw new Error(`Execution ${params.arn} still running`);
    },
    {
      retries: get(params, 'timeout', 30),
      maxTimeout: 1000
    }
  );

/**
 * Wait for an execution to be failed and return it
 *
 * @param {Object} params
 * @param {string} params.prefix - the prefix configured for the stack
 * @param {string} params.arn - an execution ARN
 * @param {Function} params.callback - an async function to invoke the api
 *   lambda that takes a prefix / user payload. Defaults to
 *   cumulusApiClient.invokeApifunction to invoke the api lambda
 * @param {integer} params.timeout - the number of seconds to wait for the
 *   execution to reach a terminal state. Defaults to 30.
 * @returns {Promise<undefined>}
 */
const getFailedExecution = async (params = {}) =>
  pRetry(
    async () => {
      // TODO Handle the case where the execution does not exist
      let execution;

      try {
        execution = await executionsApi.getExecution(
          pick(params, ['prefix', 'arn', 'callback'])
        );
      } catch (err) {
        throw new pRetry.AbortError(err);
      }

      if (execution.status === 'failed') return execution;

      if (execution.status === 'completed') {
        throw new pRetry.AbortError(
          new Error(`Execution ${params.arn} was completed, not failed`)
        );
      }

      throw new Error(`Execution ${params.arn} still running`);
    },
    {
      retries: get(params, 'timeout', 30),
      maxTimeout: 1000
    }
  );

module.exports = {
  findExecutionArn,
  getCompletedExecution,
  getFailedExecution
};
