/**
 * @module StepFunctions
 */

// https://github.com/aws/aws-sdk-js-v3/tree/main/clients/client-sfn#v2-compatible-style

import {
  DescribeExecutionOutput,
  GetExecutionHistoryOutput,
  HistoryEvent,
  ListExecutionsCommandInput,
} from '@aws-sdk/client-sfn';


import { sfn } from './services';

import { retryOnThrottlingException } from './utils';
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
 * @returns {Promise<DescribeExecutionOutput>} DescribeExecutionOutput
 *
 * @kind function
 */
export const describeExecution = retryOnThrottlingException(
  (params: AWS.StepFunctions.DescribeExecutionInput) =>
    sfn().describeExecution(params)
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
export const describeStateMachine = retryOnThrottlingException(
  (params: AWS.StepFunctions.DescribeStateMachineInput) =>
    sfn().describeStateMachine(params)
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
export const getExecutionHistory = retryOnThrottlingException(
  async (
    params: AWS.StepFunctions.GetExecutionHistoryInput,
    previousResponse: { events: HistoryEvent[] } = {
      events: [],
    }
  ): Promise<{ events: HistoryEvent[] }> => {
    const response: GetExecutionHistoryOutput
      = await sfn().getExecutionHistory(params);

    response.events = response.events || [];
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
);

export const getExecutionStatus = async (executionArn: string) => {
  const [execution, executionHistory]: [DescribeExecutionOutput, GetExecutionHistoryOutput]
    = await Promise.all([
      describeExecution({ executionArn }),
      getExecutionHistory({ executionArn }),
    ]);

  execution.stateMachineArn = execution.stateMachineArn ?? '';
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
export const listExecutions = retryOnThrottlingException(
  (params: ListExecutionsCommandInput) => sfn().listExecutions(params)
);
