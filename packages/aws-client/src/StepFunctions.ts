/**
 * @module StepFunctions
 */

import { sfn } from './services';
import { improveStackTrace, retryOnThrottlingException } from './utils';
import { inTestMode } from './test-utils';

// Utility functions

export const doesExecutionExist = (describeExecutionPromise: Promise<unknown>) =>
  describeExecutionPromise
    .then(() => true)
    .catch((error) => {
      if (error.code === 'ExecutionDoesNotExist') return false;
      if (inTestMode() && error.code === 'InvalidName') return false;
      throw error;
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
 * @returns {Promise<Object>}
 *
 * @kind function
 */
export const describeExecution = improveStackTrace(
  retryOnThrottlingException(
    (params: AWS.StepFunctions.DescribeExecutionInput) => sfn().describeExecution(params).promise()
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
 * @returns {Promise<Object>}
 *
 * @kind function
 */
export const describeStateMachine = improveStackTrace(
  retryOnThrottlingException(
    (params: AWS.StepFunctions.DescribeStateMachineInput) =>
      sfn().describeStateMachine(params).promise()
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
 * @returns {Promise<boolean>}
 *
 * @kind function
 */
export const executionExists = (executionArn: string) =>
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
 * @returns {Promise<Object>}
 *
 * @kind function
 */
export const getExecutionHistory = improveStackTrace(
  retryOnThrottlingException(
    async (
      params: AWS.StepFunctions.GetExecutionHistoryInput,
      previousResponse: { events: AWS.StepFunctions.HistoryEventList } = {
        events: [],
      }
    ): Promise<{ events: AWS.StepFunctions.HistoryEventList }> => {
      const response = await sfn().getExecutionHistory(params).promise();
      const events = [
        ...previousResponse.events,
        ...response.events,
      ];
      // If there is a nextToken, recursively call this function to get all events
      // in the execution history.
      if (response.nextToken) {
        return getExecutionHistory({
          ...params,
          nextToken: response.nextToken,
        }, {
          events,
        });
      }
      return {
        events,
      };
    }
  )
);

export const getExecutionStatus = async (executionArn: string) => {
  const [execution, executionHistory] = await Promise.all([
    describeExecution({ executionArn }),
    getExecutionHistory({ executionArn }),
  ]);

  const stateMachine = await describeStateMachine({
    stateMachineArn: execution.stateMachineArn,
  });

  return { execution, executionHistory, stateMachine };
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
 * @returns {Promise<Object>}
 *
 * @kind function
 */
export const listExecutions = improveStackTrace(
  retryOnThrottlingException(
    (params: AWS.StepFunctions.ListExecutionsInput) => sfn().listExecutions(params).promise()
  )
);
