'use strict';

const { sfn } = require('@cumulus/common/aws');

class SfnStep {
  getStartEvent(executionHistory, scheduleEvent) {
    return executionHistory.events.find((event) => {
      const isStartEvent = this.startEvents.includes(event.type);
      const previousEventIsScheduleEvent = event.previousEventId === scheduleEvent.id;
      return isStartEvent && previousEventIsScheduleEvent;
    });
  }

  getCompletedEvent(executionHistory, startEvent) {
    return executionHistory.events.find((event) => {
      const isCompletionEvent = this.completionEvents.includes(event.type);
      const previousEventIsStartEvent = event.previousEventId === startEvent.id;
      return isCompletionEvent && previousEventIsStartEvent;
    }); 
  }

  /**
   * Get the events for the lambda execution for the given workflow execution.
   * This function currently assumes one execution of the given lambda per workflow.
   *
   * @param {string} workflowExecutionArn - Arn of the workflow execution
   * @param {string} lambdaName - name of the lambda
   * @returns {Object} an object containing a schedule event, start event, and complete
   * event if exist, null if cannot find the lambda
   */
  async getLambdaExecution(workflowExecutionArn, lambdaName) {
    const executionHistory = (
      await sfn().getExecutionHistory({ executionArn: workflowExecutionArn }).promise()
    );

    // Get the event where the lambda was scheduled
    const scheduleEvent = executionHistory.events.find((event) => {
      const eventScheduled = this.scheduleEvents.includes(event.type);
      const eventDetails = event[this.eventDetailsKeys.scheduled]; 
      const isStepEvent = eventDetails && eventDetails.resource.includes(lambdaName);
      return eventScheduled && isStepEvent;
    });

    if (scheduleEvent === null || scheduleEvent === undefined) {
      console.log(`Could not find lambda ${lambdaName} in execution.`);
      return null;
    }

    let startEvent = null;
    let completeEvent = null;

    if (scheduleEvent.type !== this.startFailedEvent) {
      startEvent = this.getStartEvent(executionHistory, scheduleEvent, this);

      if (startEvent !== null && startEvent.type !== this.startFailedEvent) {
        completeEvent = this.getCompletedEvent(executionHistory, startEvent, this);
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
  async getLambdaOutput(workflowExecutionArn, lambdaName) {
    const lambdaExecution = await this.getLambdaExecution(workflowExecutionArn, lambdaName, this);

    if (lambdaExecution === null) {
      console.log(`Could not find lambda ${lambdaName} in execution.`);
      return null;
    }

    if (lambdaExecution.completeEvent === null ||
        lambdaExecution.completeEvent.type !== this.successEvent) {
      console.log(`Lambda ${lambdaName} was not successful.`);
      return null;
    }

    const succeededDetails = JSON.parse(lambdaExecution.completeEvent[this.eventDetailsKeys.succeeded].output.toString());
    return succeededDetails;
  }
};

const lambdaCompletedEvents = [
  'LambdaFunctionFailed',
  'LambdaFunctionSucceeded',
  'LambdaFunctionTimedOut'
];

class LambdaStep extends SfnStep {
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
  }
}

class ActivityStep extends SfnStep {
  constructor() {
    super();
    this.scheduleFailedEvent = 'ActivityScheduleFailed';
    this.scheduleEvents = [
      'ActivityScheduled',
      this.scheduleFailedEvent
    ];
    this.startEvents = [
      'ActivityStarted' // there is no 'ActivityStartFailed'
    ];
    this.startFailedEvent = undefined,
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
  }
}

module.exports = {
  ActivityStep,
  LambdaStep
};
