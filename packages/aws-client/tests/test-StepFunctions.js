'use strict';

const test = require('ava');
const sinon = require('sinon');
const { throttleOnce } = require('@cumulus/common/test-utils');
const awsServices = require('../services');
const StepFunctions = require('../StepFunctions');
const s3Utils = require('../S3');

const runWithStubbedAndThrottledSfnOperation = async (operation, response, fn) => {
  const operationBefore = awsServices.sfn()[operation];
  try {
    const promise = throttleOnce(() => Promise.resolve(response));

    awsServices.sfn()[operation] = () => ({ promise });

    return await fn();
  } finally {
    awsServices.sfn()[operation] = operationBefore;
  }
};

test.serial('getExecutionHistory() retries if a ThrottlingException occurs', async (t) => {
  const expectedResponse = { events: [{ test: 'test1' }] };
  const promise = throttleOnce(() => Promise.resolve(expectedResponse));
  const promiseSpy = sinon.spy();
  const stub = sinon.stub(awsServices, 'sfn')
    .returns({
      getExecutionHistory: () => ({
        promise: () => {
          promiseSpy();
          return promise();
        }
      })
    });

  try {
    const response = await StepFunctions.getExecutionHistory();
    t.deepEqual(response, expectedResponse);
    t.is(promiseSpy.callCount, 2);
  } finally {
    stub.restore();
  }
});

test.serial('getExecutionHistory() returns non-paginated list of events', async (t) => {
  const firstResponse = {
    events: [{
      name: 'event1'
    }]
  };
  const stub = sinon.stub(awsServices, 'sfn')
    .returns({
      getExecutionHistory: () => ({
        promise: () => Promise.resolve(firstResponse)
      })
    });

  try {
    const response = await StepFunctions.getExecutionHistory();
    t.deepEqual(response.events, firstResponse.events);
  } finally {
    stub.restore();
  }
});

test.serial('getExecutionHistory() returns full, paginated list of events', async (t) => {
  const firstToken = 'token1';
  const firstResponse = {
    nextToken: firstToken,
    events: [{
      name: 'event1'
    }]
  };
  const secondToken = 'token2';
  const secondResponse = {
    nextToken: secondToken,
    events: [{
      name: 'event2'
    }]
  };
  const thirdResponse = {
    events: [{
      name: 'event3'
    }]
  };
  // Throw a throttling exception for the first response from
  // awsServices.sfn().getExecutionHistory().promise()to simulate
  // real-world throttling exceptions.
  const firstResponsePromise = throttleOnce(() => Promise.resolve(firstResponse));
  const stub = sinon.stub(awsServices, 'sfn')
    .returns({
      getExecutionHistory: (params) => ({
        promise: () => {
          if (!params || !params.nextToken) {
            return firstResponsePromise();
          }

          if (params.nextToken === firstToken) {
            return Promise.resolve(secondResponse);
          }

          return Promise.resolve(thirdResponse);
        }
      })
    });

  try {
    const response = await StepFunctions.getExecutionHistory();
    t.deepEqual(response.events, [
      ...firstResponse.events,
      ...secondResponse.events,
      ...thirdResponse.events
    ]);
  } finally {
    stub.restore();
  }
});

test.serial('describeExecution() retries if a ThrottlingException occurs',
  (t) => runWithStubbedAndThrottledSfnOperation(
    'describeExecution',
    5,
    async () => t.is(await StepFunctions.describeExecution(), 5)
  ));

test.serial('listExecutions() retries if a ThrottlingException occurs',
  (t) => runWithStubbedAndThrottledSfnOperation(
    'listExecutions',
    5,
    async () => t.is(await StepFunctions.listExecutions(), 5)
  ));

test.serial('describeStateMachine() retries if a ThrottlingException occurs',
  (t) => runWithStubbedAndThrottledSfnOperation(
    'describeStateMachine',
    5,
    async () => t.is(await StepFunctions.describeStateMachine(), 5)
  ));

test('doesExecutionExist returns true if the Promise resolves', async (t) => {
  t.true(await StepFunctions.doesExecutionExist(Promise.resolve()));
});

test('doesExecutionExist returns false if the Promise rejects with an ExecutionDoesNotExist code', async (t) => {
  const err = new Error();
  err.code = 'ExecutionDoesNotExist';

  t.false(await StepFunctions.doesExecutionExist(Promise.reject(err)));
});

test('doesExecutionExist throws any non-ExecutionDoesNotExist errors', async (t) => {
  const err = new Error();

  try {
    t.false(await StepFunctions.doesExecutionExist(Promise.reject(err)));
    t.fail();
  } catch (_) {
    t.pass();
  }
});

test('toSfnExecutionName() truncates names to 80 characters', (t) => {
  t.is(
    StepFunctions.toSfnExecutionName(
      [
        '123456789_123456789_123456789_123456789_',
        '123456789_123456789_123456789_123456789_'
      ],
      ''
    ),
    '123456789_123456789_123456789_123456789_123456789_123456789_123456789_123456789_'
  );
});

test('toSfnExecutionName() joins fields by the given delimiter', (t) => {
  t.is(
    StepFunctions.toSfnExecutionName(['a', 'b', 'c'], '-'),
    'a-b-c'
  );
});

test('toSfnExecutionName() escapes occurrences of the delimiter in fields', (t) => {
  t.is(
    StepFunctions.toSfnExecutionName(['a', 'b-c', 'd'], '-'),
    'a-b!u002dc-d'
  );
});

test('toSfnExecutionName() escapes unsafe characters with unicode-like escape codes', (t) => {
  t.is(
    StepFunctions.toSfnExecutionName(['a', 'b$c', 'd'], '-'),
    'a-b!u0024c-d'
  );
});

test('toSfnExecutionName() escapes exclammation points (used for escape codes)', (t) => {
  t.is(
    StepFunctions.toSfnExecutionName(['a', 'b!c', 'd'], '-'),
    'a-b!u0021c-d'
  );
});

test('toSfnExecutionName() does not escape safe characters', (t) => {
  t.is(
    StepFunctions.toSfnExecutionName(['a', 'b.+-_=', 'c'], 'z'),
    'azb.+-_=zc'
  );
});

test('fromSfnExecutionName() returns fields separated by the given delimiter', (t) => {
  t.deepEqual(
    StepFunctions.fromSfnExecutionName('a-b-c', '-'),
    ['a', 'b', 'c']
  );
});

test('fromSfnExecutionName() interprets bang-escaped unicode in the input string', (t) => {
  t.deepEqual(
    StepFunctions.fromSfnExecutionName('a-b!u002dc-d', '-'),
    ['a', 'b-c', 'd']
  );
});

test('fromSfnExecutionName() copes with quotes in the input string', (t) => {
  t.deepEqual(
    StepFunctions.fromSfnExecutionName('foo"bar'),
    ['foo"bar']
  );
});

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
