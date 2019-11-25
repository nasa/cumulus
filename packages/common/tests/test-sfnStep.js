'use strict';

const test = require('ava');
const rewire = require('rewire');

const SfnStepModule = rewire('../sfnStep');

const {
  SfnStep,
  getStepExitedEvent,
  getTaskExitedEventOutput
} = SfnStepModule;

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

test('SfnStep.parseStepMessage parses message correctly', async (t) => {
  const event = {
    key: 'value',
    cma: {
      foo: 'bar',
      event: {
        payload: {
          granule1: 'granule1'
        }
      }
    }
  };

  t.deepEqual(await SfnStep.parseStepMessage(event), {
    key: 'value',
    foo: 'bar',
    payload: {
      granule1: 'granule1'
    }
  });
});

test.serial('SfnStep.parseStepMessage returns correct output for for remote message', async (t) => {
  const event = {
    key: 'value',
    cma: {
      foo: 'bar',
      event: {
        payload: {},
        replace: {
          Bucket: 'somebucket',
          Key: 'somekey',
          TargetPath: '$.payload'
        }
      }
    }
  };

  const fullRemoteMessage = {
    cumulus_meta: {
      state_machine: 'machine'
    },
    payload: {
      granule1: 'granule1',
      granule2: 'granule2'
    }
  };

  const pullSfEventMock = SfnStepModule.__set__('pullStepFunctionEvent', async () => fullRemoteMessage);

  try {
    t.deepEqual(await SfnStep.parseStepMessage(event), fullRemoteMessage);
  } finally {
    pullSfEventMock();
  }
});
