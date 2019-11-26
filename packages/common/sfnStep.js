'use strict';

const { isNil } = require('./util');
const { pullStepFunctionEvent } = require('./aws');
const log = require('./log');
const StepFunctions = require('./StepFunctions');

/**
 * `SfnStep` provides methods for getting the output of a step within an AWS
 * Step Function for a specific execution.
*/
class SfnStep {
  /**
   * Parse the step message.
   *
   * Merge possible keys from the CMA in the input and handle remote message
   * retrieval if necessary.
   *
   * @param {Object} stepMessage - Details for the step
   * @param {Object} stepMessage.input - Object containing input to the step
   * @param {string} [stepName] - Name for the step being parsed. Optional.
   * @returns {Object} - Parsed step input object
   */
  static async parseStepMessage(stepMessage, stepName) {
    let parsedStepMessage = stepMessage;
    if (stepMessage.cma) {
      parsedStepMessage = { ...stepMessage, ...stepMessage.cma, ...stepMessage.cma.event };
      delete parsedStepMessage.cma;
      delete parsedStepMessage.event;
    }

    if (parsedStepMessage.replace) {
      // Message was too large and output was written to S3
      log.info(`Retrieving ${stepName} output from ${JSON.stringify(parsedStepMessage.replace)}`);
      parsedStepMessage = await pullStepFunctionEvent(parsedStepMessage);
    }
    return parsedStepMessage;
  }

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

    if (scheduleEvent.type !== this.scheduleFailedEvent) {
      startEvent = this.getStartEvent(executionHistory, scheduleEvent);

      if (startEvent && startEvent.type !== this.startFailedEvent) {
        completeEvent = this.getCompletionEvent(executionHistory, startEvent);
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
      log.info(`Could not find step ${stepName} in execution.`);
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
    return (!isNil(execution.completeEvent)
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
    const stepExecutions = await this.getStepExecutions(workflowExecutionArn, stepName);
    if (stepExecutions === null || stepExecutions.length === 0) {
      log.info(`Could not find step ${stepName} in execution.`);
      return null;
    }

    const scheduleEvent = stepExecutions[0].scheduleEvent;
    const eventWasSuccessful = scheduleEvent.type === this.scheduleSuccessfulEvent;
    if (!eventWasSuccessful) log.info('Schedule event failed');

    const subStepExecutionDetails = scheduleEvent[this.eventDetailsKeys.scheduled];
    const stepInput = JSON.parse(subStepExecutionDetails.input);
    return SfnStep.parseStepMessage(stepInput, stepName);
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
      log.info(`Step ${stepName} did not complete successfully, as expected.`);
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
      log.info(`Step ${stepName} did not fail, as expected.`);
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
    const stepExecutions = await this.getStepExecutions(workflowExecutionArn, stepName);

    if (stepExecutions === null) {
      log.info(`Could not find step ${stepName} in execution.`);
      return null;
    }

    // If querying for successful step output, use the first successful
    // execution or the last execution if none were successful
    let stepExecution;
    const successfulPassedExecutions = stepExecutions
      .filter((e) => this.completedSuccessfulFilter(e));
    if (eventType === 'success'
        && successfulPassedExecutions
        && successfulPassedExecutions.length > 0) {
      stepExecution = successfulPassedExecutions[0];
    } else {
      stepExecution = stepExecutions[stepExecutions.length - 1];
    }

    if (isNil(stepExecution.completeEvent)) {
      log.info(`Step ${stepName} did not complete as expected.`);
      return null;
    }

    let stepOutput = {};
    if (eventType === 'success') {
      stepOutput = this.getSuccessOutput(stepExecution, stepName);
    } else if (eventType === 'failure') {
      stepOutput = this.getFailureOutput(stepExecution, stepName);
    }

    if (!stepOutput) {
      log.info(`Step ${stepName} did not complete ${eventType} as expected.`);
      return null;
    }

    if (stepOutput.replace) {
      // Message was too large and output was written to S3
      log.info(`Retrieving ${stepName} output from ${JSON.stringify(stepOutput.replace)}`);
      stepOutput = pullStepFunctionEvent(stepOutput);
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
    this.taskStartEvent = 'TaskStateEntered';
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
  SfnStep,
  ActivityStep,
  LambdaStep
};
