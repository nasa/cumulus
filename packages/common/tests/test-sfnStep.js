'use strict';

const test = require('ava');
const rewire = require('rewire');

const SfnStepModule = rewire('../sfnStep');

const {
  SfnStep
} = SfnStepModule;

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
