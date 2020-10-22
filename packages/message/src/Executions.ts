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

import get from 'lodash/get';
import isString from 'lodash/isString';
import { Message } from '@cumulus/types';

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
  const executionName = get(message, 'cumulus_meta.execution_name');
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
  const stateMachineArn = get(message, 'cumulus_meta.state_machine');
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
) => message.cumulus_meta?.parentExecutionArn;

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
) => message.cumulus_meta?.cumulus_version;
