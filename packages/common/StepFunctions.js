'use strict';

const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const { deprecate } = require('./util');

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
const describeExecution = (params) => {
  deprecate('@cumulus/common/StepFunctions.describeExecution', '1.17.0', '@cumulus/aws-client/StepFunctions.describeExecution');
  return StepFunctions.describeExecution(params);
};

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
const describeStateMachine = (params) => {
  deprecate('@cumulus/common/StepFunctions.describeStateMachine', '1.17.0', '@cumulus/aws-client/StepFunctions.describeStateMachine');
  return StepFunctions.describeStateMachine(params);
};

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
  return StepFunctions.doesExecutionExist(StepFunctions.describeExecution({ executionArn }));
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
const getExecutionHistory = (params) => {
  deprecate('@cumulus/common/StepFunctions.getExecutionHistory', '1.17.0', '@cumulus/aws-client/StepFunctions.getExecutionHistory');
  return StepFunctions.getExecutionHistory(params);
};

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
const listExecutions = (params) => {
  deprecate('@cumulus/common/StepFunctions.listExecutions', '1.17.0', '@cumulus/aws-client/StepFunctions.listExecutions');
  return StepFunctions.listExecutions(params);
};

module.exports = {
  describeExecution,
  describeStateMachine,
  executionExists,
  getExecutionHistory,
  listExecutions,

  // Not part of the public API, exported for testing
  doesExecutionExist: StepFunctions.doesExecutionExist
};
