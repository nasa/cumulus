'use strict';

const { sfn } = require('@cumulus/common/aws');

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
   * Get the events for the step execution for the given workflow execution.
   * This function currently assumes one execution of the given step (by step name) per workflow.
   *
   * @param {string} workflowExecutionArn - Arn of the workflow execution
   * @param {string} stepName - name of the step
   * @returns {Object} an object containing a schedule event, start event, and complete
   * event if exist, null if cannot find the step
   */
  async getStepExecution(workflowExecutionArn, stepName) {
    const executionHistory = (
      await sfn().getExecutionHistory({ executionArn: workflowExecutionArn }).promise()
    );

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

    // use last event and discard the failed ones
    // if it is activity get the last item otherwise the first
    let scheduleEvent = scheduleEvents[0];
    if (this.classType === 'activity') {
      scheduleEvent = scheduleEvents[scheduleEvents.length - 1];
    }

    let startEvent = null;
    let completeEvent = null;

    if (scheduleEvent.type !== this.startFailedEvent) {
      startEvent = this.getStartEvent(executionHistory, scheduleEvent, this);

      if (startEvent !== null && startEvent.type !== this.startFailedEvent) {
        completeEvent = this.getCompletionEvent(executionHistory, startEvent, this);
      }
    }

    return { scheduleEvent, startEvent, completeEvent };
  }

  /**
   * Get the output payload from the step, if the step succeeds
   *
   * @param {string} workflowExecutionArn - Arn of the workflow execution
   * @param {string} stepName - name of the step
   * @returns {Object} object containing the payload, null if error
   */
  async getStepOutput(workflowExecutionArn, stepName) {
    const stepExecution = await this.getStepExecution(workflowExecutionArn, stepName, this);

    if (stepExecution === null) {
      console.log(`Could not find step ${stepName} in execution.`);
      return null;
    }

    if (stepExecution.completeEvent === null ||
        stepExecution.completeEvent.type !== this.successEvent) {
      console.log(`Step ${stepName} was not successful.`);
      return null;
    }

    return JSON.parse(stepExecution.completeEvent[this.eventDetailsKeys.succeeded].output.toString());
  }
}

/**
 * `LambdaStep` is a step inside a step function that runs an AWS Lambda function.
 */
class LambdaStep extends SfnStep {
  //eslint-disable-next-line require-jsdoc
  constructor() {
    super();
    this.scheduleFailedEvent = 'LambdaFunctionScheduleFailed';
    this.scheduleEvents = [
      this.scheduleFailedEvent,
      'LambdaFunctionScheduled'
    ];
    this.startFailedEvent = 'LambdaFunctionStartFailed';
    this.startEvents = [
      this.startFailedEvent,
      'LambdaFunctionStarted'
    ];
    this.successEvent = 'LambdaFunctionSucceeded';
    this.completionEvents = [
      this.successEvent,
      'LambdaFunctionFailed',
      'LambdaFunctionTimedOut'
    ];
    this.eventDetailsKeys = {
      scheduled: 'lambdaFunctionScheduledEventDetails',
      succeeded: 'lambdaFunctionSucceededEventDetails'
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
    this.completionEvents = [
      this.successEvent,
      'ActivityFailed',
      'ActivityTimedOut'
    ];
    this.eventDetailsKeys = {
      scheduled: 'activityScheduledEventDetails',
      succeeded: 'activitySucceededEventDetails'
    };
    this.classType = 'activity';
  }
}

module.exports = {
  ActivityStep,
  LambdaStep
};
