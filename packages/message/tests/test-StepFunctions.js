'use strict';

const test = require('ava');
const rewire = require('rewire');
const sinon = require('sinon');

const s3Utils = require('@cumulus/aws-client/S3');
const StepFunctions = rewire('../StepFunctions');

test('pullStepFunctionEvent returns original message if message not on S3', async (t) => {
  const event = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution'
    },
    meta: {
      bucket: 'test bucket'
    }
  };

  const message = await StepFunctions.pullStepFunctionEvent(event);

  t.deepEqual(message, event);
});

test.serial('pullStepFunctionEvent returns message from S3 to target', async (t) => {
  const expectedMessage = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution'
    },
    payload: {
      someKey: 'some data'
    }
  };

  const event = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution'
    },
    payload: {},
    replace: {
      Bucket: 'test bucket',
      Key: 'key',
      TargetPath: '$.payload'
    }
  };

  const stub = sinon.stub(s3Utils, 'getS3Object').resolves({
    Body: JSON.stringify({ someKey: 'some data' })
  });
  try {
    const message = await StepFunctions.pullStepFunctionEvent(event);
    t.deepEqual(message, expectedMessage);
  } finally {
    stub.restore();
  }
});

test.serial('pullStepFunctionEvent returns message from S3', async (t) => {
  const fullMessage = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution'
    },
    meta: {
      bucket: 'test bucket'
    }
  };

  const event = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution'
    },
    replace: {
      Bucket: 'test bucket',
      Key: 'key'
    }
  };

  const stub = sinon.stub(s3Utils, 'getS3Object').resolves({ Body: JSON.stringify(fullMessage) });

  try {
    const message = await StepFunctions.pullStepFunctionEvent(event);
    t.deepEqual(message, fullMessage);
  } finally {
    stub.restore();
  }
});

test('StepFunctions.parseStepMessage parses message correctly', async (t) => {
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

  t.deepEqual(await StepFunctions.parseStepMessage(event), {
    key: 'value',
    foo: 'bar',
    payload: {
      granule1: 'granule1'
    }
  });
});

test.serial('StepFunctions.parseStepMessage returns correct output for for remote message', async (t) => {
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

  const pullSfEventMock = StepFunctions.__set__(
    'pullStepFunctionEvent',
    async () => fullRemoteMessage
  );

  try {
    t.deepEqual(await StepFunctions.parseStepMessage(event), fullRemoteMessage);
  } finally {
    pullSfEventMock();
  }
});
