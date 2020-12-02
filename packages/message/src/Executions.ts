'use strict';

/**
 * Utility functions for generating execution information or parsing execution information
 * from a Cumulus message
 *
 * @module Executions
 *
 * @example
 * const Executions = require('@cumulus/message/Executions');
 */

import isString from 'lodash/isString';
import { Message } from '@cumulus/types';

import { getMetaStatus } from './workflows';

type MessageWithOptionalWorkflowInfo = Message.CumulusMessage & {
  cumulus_meta: {
    workflow_start_time?: number
    workflow_stop_time?: number
  }
  meta: {
    workflow_tasks?: object
  }
};

/**
 * Build execution ARN from a state machine ARN and execution name
 *
 * @param {string} stateMachineArn - state machine ARN
 * @param {string} executionName - state machine's execution name
 * @returns {string} an execution ARN
 *
 * @alias module:Executions
 */
export const buildExecutionArn = (
  stateMachineArn: string,
  executionName: string
) => {
  if (stateMachineArn && executionName) {
    const sfArn = stateMachineArn.replace('stateMachine', 'execution');
    return `${sfArn}:${executionName}`;
  }
  return null;
};

/**
 * Returns execution URL from an execution ARN.
 *
 * @param {string} executionArn - an execution ARN
 * @returns {string} returns AWS console URL for the execution
 *
 * @alias module:Executions
 */
export const getExecutionUrlFromArn = (executionArn: string) => {
  const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
  return `https://console.aws.amazon.com/states/home?region=${region}`
         + `#/executions/details/${executionArn}`;
};

/**
 * Get state machine ARN from an execution ARN
 *
 * @param {string} executionArn - an execution ARN
 * @returns {string} a state machine ARN
 *
 * @alias module:Executions
 */
export const getStateMachineArnFromExecutionArn = (
  executionArn: string
) => {
  if (executionArn) {
    return executionArn.replace('execution', 'stateMachine').split(':').slice(0, -1).join(':');
  }
  return null;
};

/**
 * Get the execution name from a workflow message.
 *
 * @param {Message.CumulusMessage} message - A workflow message object
 * @returns {string} An execution name
 * @throws {Error} if there is no execution name
 *
 * @alias module:Executions
 */
export const getMessageExecutionName = (
  message: Message.CumulusMessage
) => {
  const executionName = message.cumulus_meta.execution_name;
  if (!isString(executionName)) {
    throw new Error('cumulus_meta.execution_name not set in message');
  }
  return executionName;
};

/**
 * Get the state machine ARN from a workflow message.
 *
 * @param {Message.CumulusMessage} message - A workflow message object
 * @returns {string} A state machine ARN
 * @throws {Error} if there is not state machine ARN
 *
 * @alias module:Executions
 */
export const getMessageStateMachineArn = (
  message: Message.CumulusMessage
) => {
  const stateMachineArn = message.cumulus_meta.state_machine;
  if (!isString(stateMachineArn)) {
    throw new Error('cumulus_meta.state_machine not set in message');
  }
  return stateMachineArn;
};

/**
 * Get the execution ARN from a workflow message.
 *
 * @param {Message.CumulusMessage} message - A workflow message object
 * @returns {null|string} A state machine execution ARN
 *
 * @alias module:Executions
 */
export const getMessageExecutionArn = (
  message: Message.CumulusMessage
) => {
  try {
    return buildExecutionArn(
      getMessageStateMachineArn(message),
      getMessageExecutionName(message)
    );
  } catch (error) {
    return null;
  }
};

/**
 * Get the parent execution ARN from a workflow message, if any.
 *
 * @param {Message.CumulusMessage} message - A workflow message object
 * @returns {undefined|string} A state machine execution ARN
 *
 * @alias module:Executions
 */
export const getMessageExecutionParentArn = (
  message: Message.CumulusMessage
): string | undefined => message.cumulus_meta?.parentExecutionArn;

/**
 * Get the Cumulus version from a workflow message, if any.
 *
 * @param {Message.CumulusMessage} message - A workflow message object
 * @returns {undefined|string} The cumulus version
 *
 * @alias module:Executions
 */
export const getMessageCumulusVersion = (
  message: Message.CumulusMessage
): string | undefined => message.cumulus_meta?.cumulus_version;

/**
 * Get the workflow tasks in a workflow message, if any.
 *
 * @param {MessageWithOptionalWorkflowInfo} message - A workflow message object
 * @returns {Object|undefined} A map of the workflow tasks
 *
 * @alias module:Executions
 */
export const getMessageWorkflowTasks = (
  message: MessageWithOptionalWorkflowInfo
): object | undefined => message.meta?.workflow_tasks;

/**
 * Get the workflow start time, if any.
 *
 * @param {MessageWithOptionalWorkflowInfo} message - A workflow message object
 * @returns {number|undefined} The workflow start time, in milliseconds
 *
 * @alias module:Executions
 */
export const getMessageWorkflowStartTime = (
  message: MessageWithOptionalWorkflowInfo
): number | undefined => message.cumulus_meta?.workflow_start_time;

/**
 * Get the workflow stop time, if any.
 *
 * @param {MessageWithOptionalWorkflowInfo} message - A workflow message object
 * @returns {number|undefined} The workflow stop time, in milliseconds
 *
 * @alias module:Executions
 */
export const getMessageWorkflowStopTime = (
  message: MessageWithOptionalWorkflowInfo
): number | undefined => message.cumulus_meta?.workflow_stop_time;

/**
 * Get the workflow name, if any.
 *
 * @param {Message.CumulusMessage} message - A workflow message object
 * @returns {string|undefined} The workflow name
 *
 * @alias module:Executions
 */
export const getMessageWorkflowName = (
  message: Message.CumulusMessage
): string | undefined => message.meta?.workflow_name;

/**
 * Get the workflow original payload, if any.
 *
 * @param {Message.CumulusMessage} message - A workflow message object
 * @returns {unknown|undefined} The workflow original payload
 *
 * @alias module:Executions
 */
export const getMessageExecutionOriginalPayload = (
  message: Message.CumulusMessage
): unknown | undefined => {
  const status = getMetaStatus(message);
  return status === 'running' ? message.payload : undefined;
};

/**
 * Get the workflow final payload, if any.
 *
 * @param {Message.CumulusMessage} message - A workflow message object
 * @returns {unknown|undefined} The workflow final payload
 *
 * @alias module:Executions
 */
export const getMessageExecutionFinalPayload = (
  message: Message.CumulusMessage
): unknown | undefined => {
  const status = getMetaStatus(message);
  return status === 'running' ? undefined : message.payload;
};
