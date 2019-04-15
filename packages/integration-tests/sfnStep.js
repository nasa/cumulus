'use strict';

const { s3 } = require('@cumulus/common/aws');
const StepFunctions = require('@cumulus/common/StepFunctions');

/**
 * `SfnStep` provides methods for getting the output of a step within an AWS
 * Step Function for a specific execution.
*/
class SfnStep {
  /**
   * `getStartEvent` gets the "start" event for a step, given its schedule event
   *
   * @param  {Object} executionHistory - AWS Step Function execution history
   * @param  {Object} scheduleEvent    - AWS Step Function schedule-type event
   * @returns {Object}                 - AWS Step Function start-type event
   */
  getStartEvent(executionHistory, scheduleEvent) {
    return executionHistory.events.find((event) => {
      const isStartEvent = this.startEvents.includes(event.type);
      const previousEventIsScheduleEvent = event.previousEventId === scheduleEvent.id;
      return isStartEvent && previousEventIsScheduleEvent;
    });
  }

  /**
   * `getCompletionEvent` gets the "completion" event for a step, given its start event
   *
   * @param  {Object} executionHistory - AWS Step Function execution history
   * @param  {Object} startEvent       - AWS Step Function start-type event
   * @returns {Object}                 - AWS Step Function completion-type event
   */
  getCompletionEvent(executionHistory, startEvent) {
    return executionHistory.events.find((event) => {
      const isCompletionEvent = this.completionEvents.includes(event.type);
      const previousEventIsStartEvent = event.previousEventId === startEvent.id;
      return isCompletionEvent && previousEventIsStartEvent;
    });
  }

  /**
   * Get the information for an instance of a step execution. Get the schedule, start,
   * and complete event.
   *
   * @param {Object} executionHistory - AWS Step Function execution history
   * @param {Object} scheduleEvent    - AWS Step Function schedule-type event
   * @returns {Object} object containing a schedule event, start event, and complete
   * event if exists for each execution of the step, null if cannot find the step
   */
  getStepExecutionInstance(executionHistory, scheduleEvent) {
    let startEvent = null;
    let completeEvent = null;

    if (scheduleEvent.type !== this.startFailedEvent) {
      startEvent = this.getStartEvent(executionHistory, scheduleEvent, this);

      if (startEvent && startEvent.type !== this.startFailedEvent) {
        completeEvent = this.getCompletionEvent(executionHistory, startEvent, this);
        return { scheduleEvent, startEvent, completeEvent };
      }
    }
    return null;
  }

  /**
   * Get the events for the step execution for the given workflow execution.
   * If there are multiple executions of a step, we currently assume a retry and return
   * either the first passed execution or the last execution if no passing executions exist
   *
   * @param {string} executionArn - Arn of the workflow execution
   * @param {string} stepName - name of the step
   * @returns {List<Object>} objects containing a schedule event, start event, and complete
   * event if exists for each execution of the step, null if cannot find the step
   */
  async getStepExecutions(executionArn, stepName) {
    const executionHistory = await StepFunctions.getExecutionHistory({ executionArn });

    // Get the event where the step was scheduled
    const scheduleEvents = executionHistory.events.filter((event) => {
      const eventScheduled = this.scheduleEvents.includes(event.type);
      const eventDetails = event[this.eventDetailsKeys.scheduled];
      const isStepEvent = eventDetails && eventDetails.resource.includes(stepName);
      return eventScheduled && isStepEvent;
    });

    if (scheduleEvents.length === 0) {
      console.log(`Could not find step ${stepName} in execution.`);
      return null;
    }

    return scheduleEvents.map((e) => this.getStepExecutionInstance(executionHistory, e))
      .filter((e) => e);
  }


  /**
   * Return truthyness of an execution being successful.
   *
   * @param {Object} execution - stepFunction execution
   * @returns {boolean} truthness of the execution being successful.
   */
  completedSuccessfulFilter(execution) {
    return (execution.completeEvent !== undefined
            && execution.completeEvent !== null
            && execution.completeEvent.type === this.successEvent);
  }

  /**
   * Gets the input to the step by looking for the 'schedule' for the given step
   * and returning the parsed input object.
   *
   * @param   {string} workflowExecutionArn - AWS Execution ARN of the step function execution
   * @param   {string} stepName             - Name of the workflow step of interest
   * @returns {Object}                      - Parsed JSON string of input to step with <stepName>
   *                                          from the workflow execution of interest.
   */
  async getStepInput(workflowExecutionArn, stepName) {
    const stepExecutions = await this.getStepExecutions(workflowExecutionArn, stepName, this);

    if (stepExecutions === null || stepExecutions.length === 0) {
      console.log(`Could not find step ${stepName} in execution.`);
      return null;
    }

    const scheduleEvent = stepExecutions[0].scheduleEvent;
    const eventWasSuccessful = scheduleEvent.type === this.scheduleSuccessfulEvent;
    if (!eventWasSuccessful) console.log('Schedule event failed');

    const subStepExecutionDetails = scheduleEvent.lambdaFunctionScheduledEventDetails;
    let stepInput = JSON.parse(subStepExecutionDetails.input);

    if (stepInput.replace) {
      // Message was too large and output was written to S3
      console.log(`Retrieving ${stepName} input from ${JSON.stringify(stepInput.replace)}`);
      stepInput = await s3().getObject(stepInput.replace).promise()
        .then((response) => JSON.parse(response.Body.toString()));
    }
    return stepInput;
  }

  /**
   * Returns JSON-parsed output from a step which completed successfully
   *
   * @param   {Object} stepExecution - AWS StepExecution
   * @param   {string} stepName      - Name of the step
   * @returns {Object}               Output of the successfully completed event
   */
  getSuccessOutput(stepExecution, stepName) {
    if (stepExecution.completeEvent.type !== this.successEvent) {
      console.log(`Step ${stepName} did not complete successfully, as expected.`);
      return null;
    }
    const completeEventOutput = stepExecution.completeEvent[this.eventDetailsKeys.succeeded];
    return JSON.parse(completeEventOutput.output.toString());
  }

  /**
   * Returns JSON-parsed output from a step which failed
   *
   * @param   {Object} stepExecution - AWS StepExecution
   * @param   {string} stepName      - Name of the step
   * @returns {Object}               Output of the failed event
   */
  getFailureOutput(stepExecution, stepName) {
    if (stepExecution.completeEvent.type !== this.failureEvent) {
      console.log(`Step ${stepName} did not fail, as expected.`);
      return null;
    }
    const completeEventOutput = stepExecution.completeEvent[this.eventDetailsKeys.failed];
    return completeEventOutput;
  }

  /**
   * Get the output payload from the step, if the step succeeds
   *
   * @param {string} workflowExecutionArn - Arn of the workflow execution
   * @param {string} stepName - name of the step
   * @param {string} eventType - expected type of event, should be 'success' or 'failure'
   * @returns {Object} object containing the payload, null if error
   */
  async getStepOutput(workflowExecutionArn, stepName, eventType = 'success') {
    const stepExecutions = await this.getStepExecutions(workflowExecutionArn, stepName, this);

    if (stepExecutions === null) {
      console.log(`Could not find step ${stepName} in execution.`);
      return null;
    }

    // If querying for successful step output, use the first successful
    // execution or the last execution if none were successful
    let stepExecution;
    const successfulPassedExecutions = stepExecutions.filter((e) => this.completedSuccessfulFilter(e));
    if (eventType === 'success'
        && successfulPassedExecutions
        && successfulPassedExecutions.length > 0) {
      stepExecution = successfulPassedExecutions[0];
    } else {
      stepExecution = stepExecutions[stepExecutions.length - 1];
    }

    if (typeof stepExecution.completeEvent === 'undefined'
        || stepExecution.completeEvent === null) {
      console.log(`Step ${stepName} did not complete as expected.`);
      return null;
    }

    let stepOutput = {};
    if (eventType === 'success') {
      stepOutput = this.getSuccessOutput(stepExecution, stepName);
    } else if (eventType === 'failure') {
      stepOutput = this.getFailureOutput(stepExecution, stepName);
    }

    if (!stepOutput) {
      console.log(`Step ${stepName} did not complete ${eventType} as expected.`);
      return null;
    }

    if (stepOutput.replace) {
      // Message was too large and output was written to S3
      console.log(`Retrieving ${stepName} output from ${JSON.stringify(stepOutput.replace)}`);
      stepOutput = await s3().getObject(stepOutput.replace).promise()
        .then((response) => JSON.parse(response.Body.toString()));
    }

    return stepOutput;
  }
}

/**
 * `LambdaStep` is a step inside a step function that runs an AWS Lambda function.
 */
class LambdaStep extends SfnStep {
  constructor() {
    super();
    this.scheduleFailedEvent = 'LambdaFunctionScheduleFailed';
    this.scheduleSuccessfulEvent = 'LambdaFunctionScheduled';
    this.scheduleEvents = [
      this.scheduleFailedEvent,
      this.scheduleSuccessfulEvent
    ];
    this.startFailedEvent = 'LambdaFunctionStartFailed';
    this.startEvents = [
      this.startFailedEvent,
      'LambdaFunctionStarted'
    ];
    this.successEvent = 'LambdaFunctionSucceeded';
    this.failureEvent = 'LambdaFunctionFailed';
    this.completionEvents = [
      this.successEvent,
      this.failureEvent,
      'LambdaFunctionTimedOut'
    ];
    this.eventDetailsKeys = {
      scheduled: 'lambdaFunctionScheduledEventDetails',
      succeeded: 'lambdaFunctionSucceededEventDetails',
      failed: 'lambdaFunctionFailedEventDetails'
    };
    this.classType = 'lambda';
  }
}

/**
 * `ActivityStep` is a step inside a step function that runs an AWS ECS activity.
 */
class ActivityStep extends SfnStep {
  //eslint-disable-next-line require-jsdoc
  constructor() {
    super();
    this.scheduleFailedEvent = 'ActivityScheduleFailed';
    this.scheduleEvents = [
      'ActivityScheduled',
      this.scheduleFailedEvent
    ];
    this.startEvents = ['ActivityStarted'];
    this.startFailedEvent = undefined; // there is no 'ActivityStartFailed'
    this.successEvent = 'ActivitySucceeded';
    this.failureEvent = 'ActivityFailed';
    this.completionEvents = [
      this.successEvent,
      this.failureEvent,
      'ActivityTimedOut'
    ];
    this.eventDetailsKeys = {
      scheduled: 'activityScheduledEventDetails',
      succeeded: 'activitySucceededEventDetails',
      failed: 'activityFailedEventDetails'
    };
    this.classType = 'activity';
  }
}

module.exports = {
  ActivityStep,
  LambdaStep
};
