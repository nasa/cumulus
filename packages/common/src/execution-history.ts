import AWS from 'aws-sdk';

export const getStepExitedEvent = (
  events: AWS.StepFunctions.HistoryEvent[],
  lastStepEvent: AWS.StepFunctions.HistoryEvent
) =>
  events.find(
    ({ type, previousEventId }) =>
      type === 'TaskStateExited' && previousEventId === lastStepEvent.id
  );

export const getTaskExitedEventOutput = (
  event: AWS.StepFunctions.HistoryEvent
) => event?.stateExitedEventDetails?.output;
