import { HistoryEvent } from '@cumulus/aws-client/StepFunctions';

export const getStepExitedEvent = (
  events: HistoryEvent[],
  lastStepEvent: HistoryEvent
) =>
  events.find(
    ({ type, previousEventId }) =>
      type === 'TaskStateExited' && previousEventId === lastStepEvent.id
  );

export const getTaskExitedEventOutput = (
  event: HistoryEvent
) => event?.stateExitedEventDetails?.output;
