'use strict';

const { deprecate } = require('./util');
const aws = require('./aws');

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
 * @kind function
 */
const describeExecution = aws.improveStackTrace(
  aws.retryOnThrottlingException(
    (params) => {
      deprecate('@cumulus/common/StepFunctions.describeExecution', '1.17.0', '@cumulus/aws-client/StepFunctions.describeExecution');
      return aws.sfn().describeExecution(params).promise();
    }
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
 * @kind function
 */
const describeStateMachine = aws.improveStackTrace(
  aws.retryOnThrottlingException(
    (params) => {
      deprecate('@cumulus/common/StepFunctions.describeStateMachine', '1.17.0', '@cumulus/aws-client/StepFunctions.describeStateMachine');
      return aws.sfn().describeStateMachine(params).promise();
    }
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
 * @kind function
 */
const executionExists = (executionArn) => {
  deprecate('@cumulus/common/StepFunctions.executionExists', '1.17.0', '@cumulus/aws-client/StepFunctions.executionExists');
  return doesExecutionExist(describeExecution({ executionArn }));
};

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
 * @kind function
 */
const getExecutionHistory = aws.improveStackTrace(
  aws.retryOnThrottlingException(
    async (
      params,
      previousResponse = {
        events: []
      }
    ) => {
      deprecate('@cumulus/common/StepFunctions.getExecutionHistory', '1.17.0', '@cumulus/aws-client/StepFunctions.getExecutionHistory');
      const response = await aws.sfn().getExecutionHistory(params).promise();
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
 * @kind function
 */
const listExecutions = aws.improveStackTrace(
  aws.retryOnThrottlingException(
    (params) => {
      deprecate('@cumulus/common/StepFunctions.listExecutions', '1.17.0', '@cumulus/aws-client/StepFunctions.listExecutions');
      return aws.sfn().listExecutions(params).promise();
    }
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
