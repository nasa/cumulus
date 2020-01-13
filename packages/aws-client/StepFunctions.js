'use strict';

/**
 * Utility functions for working with the AWS StepFunctions API
 * @module StepFunctions
 *
 * @example
 * const StepFunctions = require('@cumulus/aws-client/StepFunctions');
 */

const awsServices = require('./services');
const {
  improveStackTrace,
  retryOnThrottlingException
} = require('./utils');

// Utility functions

const doesExecutionExist = (describeExecutionPromise) =>
  describeExecutionPromise
    .then(() => true)
    .catch((err) => {
      if (err.code === 'ExecutionDoesNotExist') return false;
      throw err;
    });

// Exported functions

/**
 * Call StepFunctions DescribeExecution
 *
 * See [StepFunctions.describeExecution()](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/StepFunctions.html#describeExecution-property)
 * for descriptions of `params` and the return data.
 *
 * If a ThrottlingException is received, this function will retry using an
 * exponential backoff.
 *
 * @param {Object} params
 * @returns {Promise.<Object>}
 *
 * @static
 * @kind function
 */
const describeExecution = improveStackTrace(
  retryOnThrottlingException(
    (params) => awsServices.sfn().describeExecution(params).promise()
  )
);

/**
 * Call StepFunctions DescribeStateMachine
 *
 * See [StepFunctions.describeStateMachine()](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/StepFunctions.html#describeStateMachine-property)
 * for descriptions of `params` and the return data.
 *
 * If a ThrottlingException is received, this function will retry using an
 * exponential backoff.
 *
 * @param {Object} params
 * @returns {Promise.<Object>}
 *
 * @static
 * @kind function
 */
const describeStateMachine = improveStackTrace(
  retryOnThrottlingException(
    (params) => awsServices.sfn().describeStateMachine(params).promise()
  )
);

/**
 * Check if a Step Function Execution exists
 *
 * If a ThrottlingException is received, this function will retry using an
 * exponential backoff.
 *
 * @param {string} executionArn - the ARN of the Step Function Execution to
 *   check for
 * @returns {Promise.<boolean>}
 *
 * @static
 * @kind function
 */
const executionExists = (executionArn) =>
  doesExecutionExist(describeExecution({ executionArn }));

/**
 * Call StepFunctions GetExecutionHistory
 *
 * See [StepFunctions.getExecutionHistory()](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/StepFunctions.html#getExecutionHistory-property)
 * for descriptions of `params` and the return data.
 *
 * If a ThrottlingException is received, this function will retry using an
 * exponential backoff.
 *
 * @param {Object} params
 * @returns {Promise.<Object>}
 *
 * @static
 * @kind function
 */
const getExecutionHistory = improveStackTrace(
  retryOnThrottlingException(
    async (
      params,
      previousResponse = {
        events: []
      }
    ) => {
      const response = await awsServices.sfn().getExecutionHistory(params).promise();
      const events = [
        ...previousResponse.events,
        ...response.events
      ];
      // If there is a nextToken, recursively call this function to get all events
      // in the execution history.
      if (response.nextToken) {
        return getExecutionHistory({
          ...params,
          nextToken: response.nextToken
        }, {
          events
        });
      }
      return {
        events
      };
    }
  )
);

/**
 * Call StepFunctions ListExecutions
 *
 * See [StepFunctions.listExecutions()](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/StepFunctions.html#listExecutions-property)
 * for descriptions of `params` and the return data.
 *
 * If a ThrottlingException is received, this function will retry using an
 * exponential backoff.
 *
 * @param {Object} params
 * @returns {Promise.<Object>}
 *
 * @static
 * @kind function
 */
const listExecutions = improveStackTrace(
  retryOnThrottlingException(
    (params) => awsServices.sfn().listExecutions(params).promise()
  )
);

module.exports = {
  describeExecution,
  describeStateMachine,
  executionExists,
  getExecutionHistory,
  listExecutions,

  // Not part of the public API, exported for testing
  doesExecutionExist
};
