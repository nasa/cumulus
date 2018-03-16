'use strict';

const { sfn } = require('@cumulus/common/aws');

const lambdaScheduleEvents = [
  'LambdaFunctionScheduled',
  'LambdaFunctionScheduleFailed'
];

const lambdaStartedEvents = [
  'LambdaFunctionStartFailed',
  'LambdaFunctionStarted'
];

const lambdaCompletedEvents = [
  'LambdaFunctionFailed',
  'LambdaFunctionSucceeded',
  'LambdaFunctionTimedOut'
];

/**
 * Get the events for the lambda execution for the given workflow execution.
 * This function currently assumes one execution of the given lambda per workflow.
 *
 * @param {string} workflowExecutionArn - Arn of the workflow execution
 * @param {string} lambdaName - name of the lambda
 * @returns {Object} an object containing a schedule event, start event, and complete
 * event if exist, null if cannot find the lambda
 */
async function getLambdaExecution(workflowExecutionArn, lambdaName) {
  const executionHistory = (
    await sfn().getExecutionHistory({ executionArn: workflowExecutionArn }).promise()
  );

  // Get the event where the lambda was scheduled
  const scheduleEvent = executionHistory.events.find((event) => (
    lambdaScheduleEvents.includes(event.type)) &&
    (event.lambdaFunctionScheduledEventDetails.resource.includes(lambdaName))
  );

  if (scheduleEvent === null) {
    console.log(`Could not find lambda ${lambdaName} in execution.`);
    return null;
  }

  let startEvent = null;
  let completeEvent = null;

  if (scheduleEvent.type !== 'LambdaFunctionScheduleFailed') {
    startEvent = executionHistory.events.find((event) =>
      (lambdaStartedEvents.includes(event.type)) &&
                                              (event.previousEventId === scheduleEvent.id));

    if (startEvent !== null && startEvent.type !== 'LambdaFunctionStartFailed') {
      completeEvent = executionHistory.events.find((event) =>
        (lambdaCompletedEvents.includes(event.type)) &&
                                                (event.previousEventId === startEvent.id));
    }
  }

  return { scheduleEvent, startEvent, completeEvent };
}

/**
 * Get the output payload from the lambda, if the lambda succeeds
 *
 * @param {string} workflowExecutionArn - Arn of the workflow execution
 * @param {string} lambdaName - name of the lambda
 * @returns {Object} object containing the payload, null if error
 */
async function getLambdaOutput(workflowExecutionArn, lambdaName) {
  const lambdaExecution = await getLambdaExecution(workflowExecutionArn, lambdaName);

  if (lambdaExecution === null) {
    console.log(`Could not find lambda ${lambdaName} in execution.`);
    return null;
  }

  if (lambdaExecution.completeEvent === null ||
      lambdaExecution.completeEvent.type !== 'LambdaFunctionSucceeded') {
    console.log(`Lambda ${lambdaName} was not successful.`);
    return null;
  }

  const succeededDetails = JSON.parse(lambdaExecution.completeEvent.lambdaFunctionSucceededEventDetails.output.toString());
  return succeededDetails;
}

exports.getLambdaOutput = getLambdaOutput;
