'use strict';

const test = require('ava');
const sinon = require('sinon');

const aws = require('../aws');

const {
  SfnStep,
  getStepExitedEvent,
  getTaskExitedEventOutput
} = require('../sfnStep');

test('getStepExitedEvent returns falsy if task exited event cannot be found', (t) => {
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

  t.falsy(getStepExitedEvent(events, { id: 3 }));
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

test.serial('SfnStep.parseStepMessage returns correct output for remote payload', async (t) => {
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

  const remotePayload = {
    granule1: 'granule1',
    granule2: 'granule2'
  };

  const getObjectStub = sinon.stub(aws, 's3').returns({
    getObject: () => ({
      promise: () => Promise.resolve({
        Body: JSON.stringify(remotePayload)
      })
    })
  });

  try {
    t.deepEqual(await SfnStep.parseStepMessage(event), {
      key: 'value',
      foo: 'bar',
      payload: remotePayload
    });
  } finally {
    getObjectStub.restore();
  }
});

test.serial('SfnStep.parseStepMessage returns correct output for full remote message', async (t) => {
  const event = {
    key: 'value',
    cma: {
      foo: 'bar',
      event: {
        payload: {},
        replace: {
          Bucket: 'somebucket',
          Key: 'somekey',
          TargetPath: '$'
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

  const getObjectStub = sinon.stub(aws, 's3').returns({
    getObject: () => ({
      promise: () => Promise.resolve({
        Body: JSON.stringify(fullRemoteMessage)
      })
    })
  });

  try {
    t.deepEqual(await SfnStep.parseStepMessage(event), fullRemoteMessage);
  } finally {
    getObjectStub.restore();
  }
});
