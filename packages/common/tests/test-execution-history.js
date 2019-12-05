'use strict';

const test = require('ava');

const {
  getStepExitedEvent,
  getTaskExitedEventOutput
} = require('../execution-history');

test('getStepExitedEvent returns undefined if task exited event cannot be found', (t) => {
  const events = [
    {
      type: 'LambdafunctionFailed',
      id: 1,
      lambdaFunctionFailedEventDetails: {}
    },
    {
      type: 'TaskStateExited',
      id: 2,
      previousEventId: 1,
      stateExitedEventDetails: {
        output: {}
      }
    }
  ];

  t.is(getStepExitedEvent(events, { id: 3 }), undefined);
});

test('getStepExitedEvent returns correct task exited event', (t) => {
  const events = [
    {
      type: 'LambdafunctionFailed',
      id: 1,
      lambdaFunctionFailedEventDetails: {}
    },
    {
      type: 'TaskStateExited',
      id: 2,
      previousEventId: 1,
      stateExitedEventDetails: {
        output: {}
      }
    }
  ];

  const taskExitedEvent = getStepExitedEvent(
    events,
    { id: 1 }
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
