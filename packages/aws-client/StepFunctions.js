'use strict';

/**
 * Utility functions for working with the AWS StepFunctions API
 * @module StepFunctions
 *
 * @example
 * const StepFunctions = require('@cumulus/aws-client/StepFunctions');
 */

const { JSONPath } = require('jsonpath-plus');
const awsServices = require('./services');
const s3Utils = require('./S3');
const {
  improveStackTrace,
  retryOnThrottlingException
} = require('./utils');

// Utility functions

const doesExecutionExist = (describeExecutionPromise) =>
  describeExecutionPromise
    .then(() => true)
    .catch((err) => {
      if (err.code === 'ExecutionDoesNotExist') return false;
      throw err;
    });

/**
 * Given a character, replaces the JS unicode-escape sequence for the character
 *
 * @param {char} char - The character to escape
 * @returns {string} The unicode escape sequence for char
 *
 * @private
 */
const unicodeEscapeCharacter = (char) =>
  ['\\u', `0000${char.charCodeAt().toString(16)}`.slice(-4)].join('');

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
const describeExecution = improveStackTrace(
  retryOnThrottlingException(
    (params) => awsServices.sfn().describeExecution(params).promise()
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
const describeStateMachine = improveStackTrace(
  retryOnThrottlingException(
    (params) => awsServices.sfn().describeStateMachine(params).promise()
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
const executionExists = (executionArn) =>
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
 * @returns {Promise.<Object>}
 *
 * @kind function
 */
const getExecutionHistory = improveStackTrace(
  retryOnThrottlingException(
    async (
      params,
      previousResponse = {
        events: []
      }
    ) => {
      const response = await awsServices.sfn().getExecutionHistory(params).promise();
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
const listExecutions = improveStackTrace(
  retryOnThrottlingException(
    (params) => awsServices.sfn().listExecutions(params).promise()
  )
);

/**
 * Given a string, replaces all characters matching the passed regex with their unicode
 * escape sequences
 *
 * @param {string} str - The string to escape
 * @param {string} regex - The regex matching characters to replace (default: all chars)
 * @returns {string} The string with characters unicode-escaped
 */
const unicodeEscape = (str, regex = /[\s\S]/g) => str.replace(regex, unicodeEscapeCharacter);

/**
 * Given an array of fields, returns that a new string that's safe for use as a StepFunction,
 * execution name, where all fields are joined by a StepFunction-safe delimiter
 * Important: This transformation isn't entirely two-way. Names longer than 80 characters
 *            will be truncated.
 *
 * @param {string} fields - The fields to be injected into an execution name
 * @param {string} delimiter - An optional delimiter string to replace, pass null to make
 *   no replacements
 * @returns {string} A string that's safe to use as a StepFunctions execution name
 */
const toSfnExecutionName = (fields, delimiter = '__') => {
  let sfnUnsafeChars = '[^\\w-=+_.]';
  if (delimiter) {
    sfnUnsafeChars = `(${delimiter}|${sfnUnsafeChars})`;
  }
  const regex = new RegExp(sfnUnsafeChars, 'g');
  return fields.map((s) => s.replace(regex, unicodeEscape).replace(/\\/g, '!'))
    .join(delimiter)
    .substring(0, 80);
};

/**
 * Opposite of toSfnExecutionName. Given a delimited StepFunction execution name, returns
 * an array of its original fields
 * Important: This value may be truncated from the original because of the 80-char limit on
 *            execution names
 *
 * @param {string} str - The string to make stepfunction safe
 * @param {string} [delimiter='__'] - An optional delimiter string to replace, pass null to make
 *   no replacements
 * @returns {Array} An array of the original fields
 */
const fromSfnExecutionName = (str, delimiter = '__') =>
  str.split(delimiter)
    .map((s) => s.replace(/!/g, '\\').replace('"', '\\"'))
    .map((s) => JSON.parse(`"${s}"`));

/**
 * Returns execution ARN from a statement machine Arn and executionName
 *
 * @param {string} stateMachineArn - state machine ARN
 * @param {string} executionName - state machine's execution name
 * @returns {string} - Step Function Execution Arn
 */
const getExecutionArn = (stateMachineArn, executionName) => {
  if (stateMachineArn && executionName) {
    const sfArn = stateMachineArn.replace('stateMachine', 'execution');
    return `${sfArn}:${executionName}`;
  }
  return null;
};

const getStateMachineArn = (executionArn) => {
  if (executionArn) {
    return executionArn.replace('execution', 'stateMachine').split(':').slice(0, -1).join(':');
  }
  return null;
};

/**
 * Given a Cumulus step function event, if the message is on S3, pull the full message
 * from S3 and return, otherwise return the event.
 *
 * @param {Object} event - the Cumulus event
 * @returns {Object} - the full Cumulus message
 */
const pullStepFunctionEvent = async (event) => {
  if (!event.replace) return event;

  const remoteMsgS3Object = await s3Utils.getS3Object(
    event.replace.Bucket,
    event.replace.Key,
    { retries: 0 }
  );
  const remoteMsg = JSON.parse(remoteMsgS3Object.Body.toString());

  let returnEvent = remoteMsg;
  if (event.replace.TargetPath) {
    const replaceNodeSearch = JSONPath({
      path: event.replace.TargetPath,
      json: event,
      resultType: 'all'
    });
    if (replaceNodeSearch.length !== 1) {
      throw new Error(`Replacement TargetPath ${event.replace.TargetPath} invalid`);
    }
    if (replaceNodeSearch[0].parent) {
      replaceNodeSearch[0].parent[replaceNodeSearch[0].parentProperty] = remoteMsg;
      returnEvent = event;
      delete returnEvent.replace;
    }
  }
  return returnEvent;
};

module.exports = {
  describeExecution,
  describeStateMachine,
  executionExists,
  getExecutionHistory,
  listExecutions,
  unicodeEscape,
  toSfnExecutionName,
  fromSfnExecutionName,
  getExecutionArn,
  getStateMachineArn,
  pullStepFunctionEvent,

  // Not part of the public API, exported for testing
  doesExecutionExist
};
