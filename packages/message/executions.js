const get = require('lodash.get');
const isString = require('lodash.isstring');

/**
 * Build execution ARN from a state machine ARN and execution name
 *
 * @param {string} stateMachineArn - state machine ARN
 * @param {string} executionName - state machine's execution name
 * @returns {string} - an execution ARN
 */
const buildExecutionArn = (stateMachineArn, executionName) => {
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
 */
function getExecutionUrlFromArn(executionArn) {
  const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
  return `https://console.aws.amazon.com/states/home?region=${region}`
         + `#/executions/details/${executionArn}`;
}

/**
 * Get state machine ARN from an execution ARN
 *
 * @param {string} executionArn - an execution ARN
 * @returns {string} - a state machine ARN
 */
const getStateMachineArnFromExecutionArn = (executionArn) => {
  if (executionArn) {
    return executionArn.replace('execution', 'stateMachine').split(':').slice(0, -1).join(':');
  }
  return null;
};

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
    return buildExecutionArn(
      getMessageStateMachineArn(message),
      getMessageExecutionName(message)
    );
  } catch (err) {
    return null;
  }
};

module.exports = {
  buildExecutionArn,
  getExecutionUrlFromArn,
  getStateMachineArnFromExecutionArn,
  getMessageExecutionArn,
  getMessageExecutionName,
  getMessageStateMachineArn
}
