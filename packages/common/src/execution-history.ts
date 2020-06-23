export const getStepExitedEvent = (
  events: Array<{
    type: string,
    previousEventId: string
  }>,
  lastStepEvent: {id: string}
) =>
  events.find(
    (event) =>
      event.type === 'TaskStateExited'
        && event.previousEventId === lastStepEvent.id
  );

export const getTaskExitedEventOutput = (
  event: {
    stateExitedEventDetails: {
      output: unknown
    }
  }
) => event.stateExitedEventDetails.output;
