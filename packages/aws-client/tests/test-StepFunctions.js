'use strict';

const test = require('ava');
const sinon = require('sinon');

const awsServices = require('../services');
const { throttleOnce } = require('../test-utils');
const StepFunctions = require('../StepFunctions');

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
        },
      }),
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
      name: 'event1',
    }],
  };
  const stub = sinon.stub(awsServices, 'sfn')
    .returns({
      getExecutionHistory: () => ({
        promise: () => Promise.resolve(firstResponse),
      }),
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
      name: 'event1',
    }],
  };
  const secondToken = 'token2';
  const secondResponse = {
    nextToken: secondToken,
    events: [{
      name: 'event2',
    }],
  };
  const thirdResponse = {
    events: [{
      name: 'event3',
    }],
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
        },
      }),
    });

  try {
    const response = await StepFunctions.getExecutionHistory();
    t.deepEqual(response.events, [
      ...firstResponse.events,
      ...secondResponse.events,
      ...thirdResponse.events,
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

test('executionExists returns false if the execution does not exist', async (t) => {
  const executionArn = 'arn:aws:states:us-east-1:123456789012:execution:MyStackIngestAndPublishGranuleStateMachine:c154d37a-98e5-4ca9-9653-35f4ae9b59d3';
  t.false(await StepFunctions.executionExists(executionArn));
});
