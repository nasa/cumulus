'use strict';

const test = require('ava');

const {
  getExecutionFailedEvent,
  getLastFailedStepEvent,
  getStepExitedEvent,
  getTaskExitedEventOutput
} = require('../sfnStep');
const { randomId, randomNumber } = require('../test-utils');

const failedStepOutput = {
  error: 'Error',
  cause: '{\"errorMessage\":\"{\\\"errorMessage\\\":\\\"CMR Error: Invalid username or password, please retry.\\\",\\\"errorType\\\":\\\"Error\\\",\\\"stackTrace\\\":[\\\"updateToken (/var/task/index.js:437:41)\\\",\\\"<anonymous>\\\",\\\"process._tickDomainCallback (internal/process/next_tick.js:228:7)\\\"]}\",\"errorType\":\"Error\",\"stackTrace\":[\"buildError (/var/task/index.js:20549:10)\",\"makeLambdaFunctionFail (/var/task/index.js:20564:20)\",\"publishSnsMessage (/var/task/index.js:20618:5)\",\"<anonymous>\",\"process._tickDomainCallback (internal/process/next_tick.js:228:7)\"]}'
};

const failedStepException = {
  error: 'Error',
  cause: '{\"errorMessage\":\"{\\\"errorMessage\\\":\\\"CMR Error: Invalid username or password, please retry.\\\",\\\"errorType\\\":\\\"Error\\\",\\\"stackTrace\\\":[\\\"updateToken (/var/task/index.js:437:41)\\\",\\\"<anonymous>\\\",\\\"process._tickDomainCallback (internal/process/next_tick.js:228:7)\\\"]}\",\"errorType\":\"Error\",\"stackTrace\":[\"buildError (/var/task/index.js:20549:10)\",\"makeLambdaFunctionFail (/var/task/index.js:20564:20)\",\"publishSnsMessage (/var/task/index.js:20618:5)\",\"<anonymous>\",\"process._tickDomainCallback (internal/process/next_tick.js:228:7)\"]}'
};

const createFakeExecutionHistory = ({
  message,
  completedStepId = randomNumber(),
  stepName = randomId('stepName'),
  stepType = 'lambda',
  timestamp = Date.now(),
  failed = true,
  finalEventType = 'taskExit'
}) => {
  const isLambdaHistory = stepType === 'lambda';
  const scheduledDetailsKey = isLambdaHistory
    ? 'lambdaFunctionScheduledEventDetails'
    : 'activityScheduledEventDetails';

  let completedDetailsKey;
  let completionEventType;
  if (failed) {
    completedDetailsKey = isLambdaHistory ? 'lambdaFunctionFailedEventDetails' : 'activityFailedEventDetails';
    completionEventType = isLambdaHistory ? 'LambdaFunctionFailed' : 'ActivityFailed';
  } else {
    completedDetailsKey = isLambdaHistory ? 'lambdaFunctionSucceededEventDetails' : 'activitySucceededEventDetails';
    completionEventType = isLambdaHistory ? 'LambdaFunctionSucceeded' : 'ActivitySucceeded';
  }

  const events = [
    {
      timestamp,
      type: isLambdaHistory ? 'LambdaFunctionScheduled' : 'ActivityScheduled',
      [scheduledDetailsKey]: {
        resource: stepName,
        input: JSON.stringify(message)
      }
    },
    {
      timestamp: timestamp + 100,
      type: isLambdaHistory ? 'LambdaFunctionStarted' : 'ActivityStarted'
    },
    {
      timestamp: timestamp + 200,
      type: completionEventType,
      id: completedStepId,
      [completedDetailsKey]: failed ? failedStepOutput : {}
    }
  ];

  if (finalEventType === 'taskExit') {
    const additionalOutput = failed
      ? { exception: failedStepException }
      : {};
    events.push({
      timestamp: timestamp + 200,
      type: 'TaskStateExited',
      id: completedStepId + 1,
      previousEventId: completedStepId,
      stateExitedEventDetails: {
        name: stepName,
        output: JSON.stringify({
          ...message,
          ...additionalOutput
        })
      }
    });
  } else if (finalEventType === 'executionFail') {
    events.push({
      timestamp: timestamp + 200,
      type: 'ExecutionFailed',
      id: completedStepId + 1,
      previousEventId: completedStepId,
      executionFailedEventDetails: failedStepException
    });
  }

  return {
    events
  };
};

const createCumulusMessage = ({
  cMetaParams = {},
  payload = {}
} = {}) => ({
  cumulus_meta: {
    execution_name: randomId('execution'),
    state_machine: randomId('ingest-'),
    ...cMetaParams
  },
  payload
});

test.beforeEach((t) => {
  t.context.completedStepId = randomNumber();
  t.context.invalidFailedStepId = randomNumber();
  // Ensure that the invalid failed step ID does not match an event ID
  // in the execution history
  while (t.context.completedStepId === t.context.invalidFailedStepId) {
    t.context.invalidFailedStepId = randomNumber();
  }
});

test('getLastFailedStepEvent returns falsy if failed step event cannot be found', (t) => {
  const message = createCumulusMessage();
  const fakeExecutionHistory = createFakeExecutionHistory({
    message,
    failed: false
  });
  t.falsy(getLastFailedStepEvent(fakeExecutionHistory.events));
});

test('getLastFailedStepEvent returns failed activity step event', (t) => {
  const message = createCumulusMessage();
  const fakeExecutionHistory = createFakeExecutionHistory({
    message,
    stepType: 'activity'
  });
  t.truthy(getLastFailedStepEvent(fakeExecutionHistory.events));
});

test('getLastFailedStepEvent returns failed lambda step event', (t) => {
  const message = createCumulusMessage();
  const fakeExecutionHistory = createFakeExecutionHistory({
    message
  });
  t.truthy(getLastFailedStepEvent(fakeExecutionHistory.events));
});

test('getStepExitedEvent returns falsy if task exited event cannot be found', (t) => {
  const { completedStepId, invalidFailedStepId } = t.context;

  const message = createCumulusMessage();
  const fakeExecutionHistory = createFakeExecutionHistory({
    message,
    failed: false,
    completedStepId
  });
  t.falsy(getStepExitedEvent(fakeExecutionHistory.events, { id: invalidFailedStepId }));
});

test('getStepExitedEvent returns correct task exited event', (t) => {
  const { completedStepId } = t.context;

  const message = createCumulusMessage();
  const fakeExecutionHistory = createFakeExecutionHistory({
    message,
    failed: false,
    completedStepId
  });

  const taskExitedEvent = getStepExitedEvent(
    fakeExecutionHistory.events,
    { id: completedStepId }
  );
  t.truthy(taskExitedEvent);
  t.is(taskExitedEvent.type, 'TaskStateExited');
  t.truthy(taskExitedEvent.stateExitedEventDetails);
});

test('getTaskExitedEventOutput returns correct output', (t) => {
  const payload = {
    foo: 'bar'
  };
  const event = {
    stateExitedEventDetails: {
      output: JSON.stringify(payload)
    }
  };
  const output = getTaskExitedEventOutput(event);
  t.deepEqual(JSON.parse(output), payload);
});
