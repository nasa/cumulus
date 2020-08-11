'use strict';

const test = require('ava');
const sinon = require('sinon');

const s3Utils = require('@cumulus/aws-client/S3');
const StepFunctions = require('../StepFunctions');

test('pullStepFunctionEvent returns original message if message does not contain an event.replace key ', async (t) => {
  const event = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution',
    },
    meta: {
      bucket: 'test bucket',
    },
  };

  const message = await StepFunctions.pullStepFunctionEvent(event);

  t.deepEqual(message, event);
});

test.serial('pullStepFunctionEvent replaces message key specified by replace.TargetPath with S3 message object', async (t) => {
  const expectedMessage = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution',
    },
    payload: {
      someKey: 'some data',
    },
  };

  const event = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution',
    },
    payload: {},
    replace: {
      Bucket: 'test bucket',
      Key: 'key',
      TargetPath: '$.payload',
    },
  };

  const stub = sinon.stub(s3Utils, 'getJsonS3Object').resolves(
    { someKey: 'some data' }
  );
  t.teardown(() => stub.restore());

  const message = await StepFunctions.pullStepFunctionEvent(event);
  t.deepEqual(message, expectedMessage);
});

test.serial('pullStepFunctionEvent replaces entire message with S3 message object if replace.TargetPath is not specified', async (t) => {
  const fullMessage = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution',
    },
    meta: {
      bucket: 'test bucket',
    },
  };

  const event = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution',
    },
    replace: {
      Bucket: 'test bucket',
      Key: 'key',
    },
  };

  const stub = sinon.stub(s3Utils, 'getJsonS3Object').resolves(fullMessage);
  t.teardown(() => stub.restore());

  const message = await StepFunctions.pullStepFunctionEvent(event);
  t.deepEqual(message, fullMessage);
});

test.serial('pullStepFunctionEvent throws error if replace.TargetPath cannot be found in the source message', async (t) => {
  const event = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution',
    },
    replace: {
      Bucket: 'test bucket',
      Key: 'key',
      TargetPath: 'fakeKey',
    },
  };

  const stub = sinon.stub(s3Utils, 'getS3Object').resolves({});
  t.teardown(() => stub.restore());

  await t.throwsAsync(StepFunctions.pullStepFunctionEvent(event));
});

test('StepFunctions.parseStepMessage parses message correctly', async (t) => {
  const event = {
    key: 'value',
    cma: {
      foo: 'bar',
      event: {
        payload: {
          granule1: 'granule1',
        },
      },
    },
  };

  t.deepEqual(await StepFunctions.parseStepMessage(event), {
    key: 'value',
    foo: 'bar',
    payload: {
      granule1: 'granule1',
    },
  });
});

test.serial('StepFunctions.parseStepMessage returns correct output if input message refers to a remote S3 message object', async (t) => {
  const event = {
    key: 'value',
    cma: {
      foo: 'bar',
      event: {
        payload: {},
        replace: {
          Bucket: 'somebucket',
          Key: 'somekey',
          TargetPath: '$',
        },
      },
    },
  };
  const fullRemoteMessage = {
    cumulus_meta: {
      state_machine: 'machine',
    },
    payload: {
      granule1: 'granule1',
      granule2: 'granule2',
    },
  };

  const stub = sinon.stub(s3Utils, 'getJsonS3Object');
  stub.withArgs('somebucket', 'somekey')
    .resolves(fullRemoteMessage);
  t.teardown(() => stub.restore());

  t.deepEqual(await StepFunctions.parseStepMessage(event), fullRemoteMessage);
});
