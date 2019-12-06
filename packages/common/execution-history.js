const taskExitedEventType = 'TaskStateExited';
const taskExitedEventDetailsKey = 'stateExitedEventDetails';

const getStepExitedEvent = (events, lastStepEvent) =>
  events.find(
    (event) =>
      event.type === taskExitedEventType
        && event.previousEventId === lastStepEvent.id
  );

const getTaskExitedEventOutput = (event) => event[taskExitedEventDetailsKey].output;

module.exports = {
  getStepExitedEvent,
  getTaskExitedEventOutput
};
