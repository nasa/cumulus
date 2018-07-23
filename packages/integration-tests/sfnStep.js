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

      if (startEvent !== null && startEvent.type !== this.startFailedEvent) {
        completeEvent = this.getCompletionEvent(executionHistory, startEvent, this);
      }
    }

    return { scheduleEvent, startEvent, completeEvent };
  }

  /**
   * Get the events for the step execution for the given workflow execution.
   * If there are multiple executions of a step, we currently assume a retry and return
   * either the first passed execution or the last execution if no passing executions exist
   *
   * @param {string} workflowExecutionArn - Arn of the workflow execution
   * @param {string} stepName - name of the step
   * @returns {List<Object>} objects containing a schedule event, start event, and complete
   * event if exists for each execution of the step, null if cannot find the step
   */
  async getStepExecutions(workflowExecutionArn, stepName) {
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

    return scheduleEvents.map((e) => this.getStepExecutionInstance(executionHistory, e));
  }

  /**
   * Get the output payload from the step, if the step succeeds
   *
   * @param {string} workflowExecutionArn - Arn of the workflow execution
   * @param {string} stepName - name of the step
   * @returns {Object} object containing the payload, null if error
   */
  async getStepOutput(workflowExecutionArn, stepName) {
    const stepExecutions = await this.getStepExecutions(workflowExecutionArn, stepName, this);

    if (stepExecutions === null) {
      console.log(`Could not find step ${stepName} in execution.`);
      return null;
    }

    // Use the first passed execution, or last execution if none passed
    let stepExecution = stepExecutions[stepExecutions.length - 1];
    const passedExecutions = stepExecutions.filter((e) => {
      if ((e.completeEvent !== null)
          && ((e.completeEvent === undefined) || !('type' in e.completeEvent))) {
        console.log(`incomplete Execution discovered found e : ${JSON.stringify(e)}`);
      }
      return (typeof e.completeEvent !== 'undefined'
              && e.completeEvent !== null
              && e.completeEvent.type === this.successEvent);
    });
    if (passedExecutions && passedExecutions.length > 0) {
      stepExecution = passedExecutions[0];
    }

    if (typeof stepExecution.completeEvent === 'undefined'
        || stepExecution.completeEvent === null
        || stepExecution.completeEvent.type !== this.successEvent) {
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
