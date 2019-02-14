'use strict';

const { IncompleteError } = require('@cumulus/common/errors');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const log = require('@cumulus/common/log');
const StepFunctions = require('@cumulus/common/StepFunctions');

// The default number of times to re-check for completion
const defaultRetryLimit = 30;

/**
 * Determine the number of times this check has been performed
 *
 * If not set, defaults to 0.
 *
 * @param {Object} event - a simple Cumulus event
 * @returns {integer} - the number of times this check has been run
 */
const getCounterFromEvent = (event) => event.input.counter || 0;

/**
 * Determine the maximum number of times this check may be performed
 *
 * @param {Object} event - a simple Cumulus event
 * @returns {integer} - the limit on how many times this check may be run
 */
const getLimitFromEvent = (event) => event.input.limit || defaultRetryLimit;

/**
 * Group Step Function executions into "completed", "aborted", "failed",
 * and "running".
 *
 * @param {Array.<Object>} executions - described Step Function executions
 * @returns {Object} - executions grouped by status
 */
function groupExecutionsByStatus(executions) {
  const result = {
    completed: [],
    aborted: [],
    failed: [],
    running: []
  };

  executions.forEach((execution) => {
    if (execution.status === 'SUCCEEDED') result.completed.push(execution);
    else if (execution.status === 'FAILED') result.failed.push(execution);
    else if (execution.status === 'ABORTED') result.aborted.push(execution);
    else result.running.push(execution);
  });

  return result;
}

/**
 * Display output
 *
 * @param {Object} output - the output of the task
 * @returns {undefined} - no return value
 */
function logStatus(output) {
  log.info({
    running: output.running.length,
    completed: output.completed.length,
    failed: output.failed.length,
    counter: output.counter,
    limit: output.limit
  }, 'latest status');
}

/**
 * Create a task return value for a set of executions
 *
 * Example output:
 *   {
 *     isFinished: false,
 *     running: ['arn:123'],
 *     failed: [
 *       { arn: 'arn:456', reason: 'Workflow Aborted' }
 *     ],
 *     completed: [],
 *     pdr: {}
 *   }
 *
 * @param {Object} event - the event that came into checkPdrStatuses
 * @param {Object} groupedExecutions - a map of execution statuses grouped
 *   by status
 * @returns {Object} - a description of the results of this task execution
 */
function buildOutput(event, groupedExecutions) {
  const getExecutionArn = (execution) => execution.executionArn;

  const parseFailedExecution = (execution) => {
    let reason = 'Workflow Failed';
    if (execution.output) reason = JSON.parse(execution.output).exception;
    return { arn: execution.executionArn, reason };
  };

  const parseAbortedExecution = (execution) => {
    let reason = 'Workflow Aborted';
    if (execution.output) reason = JSON.parse(execution.output).exception;
    return { arn: execution.executionArn, reason };
  };

  const running = groupedExecutions.running.map(getExecutionArn);

  const failed = (event.input.failed || [])
    .concat(groupedExecutions.aborted.map(parseAbortedExecution))
    .concat(groupedExecutions.failed.map(parseFailedExecution));

  const completed = (event.input.completed || [])
    .concat(groupedExecutions.completed.map(getExecutionArn));

  const output = {
    isFinished: groupedExecutions.running.length === 0,
    running,
    failed,
    completed,
    pdr: event.input.pdr
  };

  if (!output.isFinished) {
    output.counter = getCounterFromEvent(event) + 1;
    output.limit = getLimitFromEvent(event);
  }

  return output;
}

/**
 * check the status of a step funciton execution
 *
 * @param {string} executionArn - step function execution arn
 * @returns {Promise.<Object>} - an object describing the status of the exection
 */
function describeExecutionStatus(executionArn) {
  return StepFunctions.describeExecution({ executionArn })
    .catch((e) => {
      if (e.code === 'ExecutionDoesNotExist') {
        return { executionArn: executionArn, status: 'RUNNING' };
      }
      throw e;
    });
}
/**
 * Checks a list of Step Function Executions to see if they are all in
 * terminal states.
 *
 * @param {Object} event - a Cumulus Message that has been sent through the
 *   Cumulus Message Adapter
 * @returns {Promise.<Object>} - an object describing the status of Step
 *   Function executions related to a PDR
 */
async function checkPdrStatuses(event) {
  const runningExecutionArns = event.input.running || [];

  return Promise.all(runningExecutionArns.map(describeExecutionStatus))
    .then(groupExecutionsByStatus)
    .then((groupedExecutions) => {
      const counter = getCounterFromEvent(event) + 1;
      const exceededLimit = counter >= getLimitFromEvent(event);

      const executionsAllDone = groupedExecutions.running.length === 0;

      if (!executionsAllDone && exceededLimit) {
        throw new IncompleteError(`PDR didn't complete after ${counter} checks`);
      }

      const output = buildOutput(event, groupedExecutions);
      if (!output.isFinished) logStatus(output);
      return output;
    });
}
exports.checkPdrStatuses = checkPdrStatuses;

/**
 * Lambda handler
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(checkPdrStatuses, event, context, callback);
}
exports.handler = handler;
