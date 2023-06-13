'use strict';

import pRetry from 'p-retry';
import { v4 as uuidv4 } from 'uuid';
import { Context } from 'aws-lambda';

import { sfn } from '@cumulus/aws-client/services';
import { describeExecution } from '@cumulus/aws-client/StepFunctions';
import { runCumulusTask, CumulusMessageWithAssignedPayload } from '@cumulus/cumulus-message-adapter-js';
import Logger from '@cumulus/logger';
import { buildExecutionArn } from '@cumulus/message/Executions';
import { CumulusMessage, CumulusRemoteMessage } from '@cumulus/types/message';

import { HandlerEvent, HandlerOutput } from './types';

const log = new Logger({ sender: '@cumulus/orca-recovery-adapter' });

/**
 * Get state machine execution results
 *
 * @param {object} params
 * @param {string} params.executionArn - execution arn
 * @param {number} params.retries - number of retries
 * @param {number} params.retryIntervalInSecond - retry internal in second
 * @param {number} params.maxRetryTimeInSecond - max retry time in second
 * @returns Promise<AWS.StepFunctions.DescribeExecutionOutput> - Returns promise
 *   that resolves to the output of step function execution
 */
export const getStateMachineExecutionResults = async (
  params: {
    executionArn: string,
    retries?: number,
    retryIntervalInSecond?: number,
    maxRetryTimeInSecond?: number,
  }
) : Promise<AWS.StepFunctions.DescribeExecutionOutput> => {
  const {
    executionArn,
    retries = 50,
    retryIntervalInSecond = 5,
    maxRetryTimeInSecond = 1800,
  } = params;
  const result = await pRetry(
    async () => {
      const response = await describeExecution({ executionArn });
      if (response.status === 'RUNNING') {
        throw new Error(`Waiting for recovery workflow ${executionArn} to complete`);
      }
      return response;
    },
    {
      retries,
      minTimeout: retryIntervalInSecond * 1000,
      maxTimeout: maxRetryTimeInSecond * 1000,
      maxRetryTime: maxRetryTimeInSecond * 1000,
      onFailedAttempt: (error) => {
        log.debug(`Attempt ${error.attemptNumber} times to get result ${executionArn}. ${error.retriesLeft} remain at ${new Date().toString()}`);
      },
    }
  );
  return result;
};

/**
 * Invoke ORCA Recovery workflow
 *
 * @param {HandlerEvent} event - input from the message adapter
 * @returns {Promise<HandlerOutput>} - returns output from ORCA workflow
 */
export const invokeOrcaRecoveryWorkflow = async (
  event: HandlerEvent
) : Promise<HandlerOutput> => {
  const workflowArn = process.env.orca_sfn_recovery_workflow_arn;
  if (!workflowArn?.length) {
    log.error('Environment orca_sfn_recovery_workflow_arn is not set');
    throw new Error('Environment orca_sfn_recovery_workflow_arn is not set');
  }

  const payload = {
    payload: event.input,
    config: event.config,
  };

  const currentWorkflowArn = buildExecutionArn(
    event.cumulus_config?.state_machine || '',
    event.cumulus_config?.execution_name || ''
  );

  const childExecutionName = uuidv4();
  const childWorkflowArn = buildExecutionArn(workflowArn, childExecutionName);
  log.info(`${currentWorkflowArn} about to start execution ${childWorkflowArn}`);
  const workflowParams = {
    stateMachineArn: workflowArn,
    input: JSON.stringify(payload),
    name: childExecutionName,
  };

  try {
    await sfn().startExecution(workflowParams).promise();
  } catch (error) {
    log.error(`Error starting ${childWorkflowArn}`, error);
    throw error;
  }

  log.info(`About to get result from execution ${childWorkflowArn}`);
  const executionResult = await getStateMachineExecutionResults({ executionArn: childWorkflowArn || '' });
  log.info(`Get result from execution ${childWorkflowArn}, status ${executionResult?.status}`);
  if (executionResult?.status === 'FAILED') {
    throw new Error(`Error execute ${childWorkflowArn}, result from execution ${JSON.stringify(executionResult)}`);
  }
  const executionOutput = executionResult?.outputDetails?.included ? JSON.parse(executionResult.output ?? '{}') : undefined;
  return executionOutput;
};

/**
 * Lambda handler
 *
 * @param {object} event      - a Cumulus Message
 * @param {object} context    - an AWS Lambda context
 * @returns {Promise<object>} - Returns output from task.
 *                              See schemas/output.json for detailed output schema
 */
export const handler = async (
  event: CumulusMessage | CumulusRemoteMessage,
  context: Context
): Promise<CumulusMessageWithAssignedPayload
| CumulusRemoteMessage> => await runCumulusTask(invokeOrcaRecoveryWorkflow, event, context);
