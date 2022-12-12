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
import isNil from 'lodash/isNil';
import omitBy from 'lodash/omitBy';
import isUndefined from 'lodash/isUndefined';

import { Message } from '@cumulus/types';
import { ApiExecution } from '@cumulus/types/api/executions';

import {
  getMessageAsyncOperationId,
} from './AsyncOperations';
import {
  getCollectionIdFromMessage,
} from './Collections';
import {
  getMetaStatus,
  getMessageWorkflowTasks,
  getMessageWorkflowStartTime,
  getMessageWorkflowStopTime,
  getMessageWorkflowName,
  getWorkflowDuration,
} from './workflows';
import { parseException } from './utils';

interface MessageWithPayload extends Message.CumulusMessage {
  payload: object
}

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
 * Get the workflow original payload, if any.
 *
 * @param {MessageWithPayload} message - A workflow message object
 * @returns {unknown|undefined} The workflow original payload
 *
 * @alias module:Executions
 */
export const getMessageExecutionOriginalPayload = (
  message: MessageWithPayload
) => {
  const status = getMetaStatus(message);
  return status === 'running' ? message.payload : undefined;
};

/**
 * Get the workflow final payload, if any.
 *
 * @param {MessageWithPayload} message - A workflow message object
 * @returns {unknown|undefined} The workflow final payload
 *
 * @alias module:Executions
 */
export const getMessageExecutionFinalPayload = (
  message: MessageWithPayload
) => {
  const status = getMetaStatus(message);
  return status === 'running' ? undefined : message.payload;
};

/**
 * Generate an execution record for the API from the message.
 *
 * @param {MessageWithPayload} message - A workflow message object
 * @param {string} [updatedAt] - Optional updated timestamp to apply to record
 * @returns {ApiExecution} An execution API record
 *
 * @alias module:Executions
 */
export const generateExecutionApiRecordFromMessage = (
  message: MessageWithPayload,
  updatedAt = Date.now()
): ApiExecution => {
  const arn = getMessageExecutionArn(message);
  const name = getMessageExecutionName(message);
  if (isNil(arn)) throw new Error('Unable to determine execution ARN from Cumulus message');
  if (isNil(name)) throw new Error('Unable to determine execution name from Cumulus message');

  const status = getMetaStatus(message);
  if (!status) throw new Error('Unable to determine status from Cumulus message');

  const workflowStartTime = getMessageWorkflowStartTime(message);
  const workflowStopTime = getMessageWorkflowStopTime(message);
  const collectionId = getCollectionIdFromMessage(message);

  const record : ApiExecution = {
    name,
    cumulusVersion: getMessageCumulusVersion(message),
    arn,
    asyncOperationId: getMessageAsyncOperationId(message),
    parentArn: getMessageExecutionParentArn(message),
    execution: getExecutionUrlFromArn(arn),
    tasks: getMessageWorkflowTasks(message),
    error: parseException(message.exception),
    type: getMessageWorkflowName(message),
    collectionId,
    status,
    createdAt: workflowStartTime,
    timestamp: updatedAt,
    updatedAt,
    originalPayload: getMessageExecutionOriginalPayload(message),
    finalPayload: getMessageExecutionFinalPayload(message),
    duration: getWorkflowDuration(workflowStartTime, workflowStopTime),
  };

  return <ApiExecution>omitBy(record, isUndefined);
};
