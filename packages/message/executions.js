const get = require('lodash.get');
const isString = require('lodash.isstring');
const { getExecutionArn } = require('@cumulus/aws-client/StepFunctions');

/**
 * Get the execution name from a workflow message.
 *
 * @param {Object} message - A workflow message object
 * @returns {string} - An execution name
 */
const getMessageExecutionName = (message) => {
  const executionName = get(message, 'cumulus_meta.execution_name');
  if (!isString(executionName)) {
    throw new Error('cumulus_meta.execution_name not set in message');
  }
  return executionName;
};

/**
 * Get the state machine ARN from a workflow message.
 *
 * @param {Object} message - A workflow message object
 * @returns {string} - A state machine ARN
 */
const getMessageStateMachineArn = (message) => {
  const stateMachineArn = get(message, 'cumulus_meta.state_machine');
  if (!isString(stateMachineArn)) {
    throw new Error('cumulus_meta.state_machine not set in message');
  }
  return stateMachineArn;
};

/**
 * Get the execution ARN from a workflow message.
 *
 * @param {Object} message - A workflow message object
 * @returns {null|string} - A state machine execution ARN
 */
const getMessageExecutionArn = (message) => {
  try {
    return getExecutionArn(
      getMessageStateMachineArn(message),
      getMessageExecutionName(message)
    );
  } catch (err) {
    return null;
  }
};

module.exports = {
  getMessageExecutionArn,
  getMessageExecutionName,
  getMessageStateMachineArn
}
