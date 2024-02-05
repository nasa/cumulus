'use strict';

const test = require('ava');
const sinon = require('sinon');

const awsServices = require('../services');
const { throttleOnce } = require('../test-utils');
const StepFunctions = require('../StepFunctions');

test.serial('getExecutionHistory() retries if a ThrottlingException occurs', async (t) => {
  const expectedResponse = { events: [{ test: 'test1' }] };
  const promise = throttleOnce(() => Promise.resolve(expectedResponse));
  const promiseSpy = sinon.spy();
  const stub = sinon.stub(awsServices, 'sfn')
    .returns({
      getExecutionHistory: () => {
        promiseSpy();
        return promise();
      },
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
      getExecutionHistory: () =>
        Promise.resolve(firstResponse),
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
      getExecutionHistory: (params) => {
        if (!params || !params.nextToken) {
          return firstResponsePromise();
        }

        if (params.nextToken === firstToken) {
          return Promise.resolve(secondResponse);
        }

        return Promise.resolve(thirdResponse);
      },
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

test.serial('describeExecution() retries if a ThrottlingException occurs', async (t) => {
  const expectedResponse = { events: [{ test: 'test1' }] };
  const promise = throttleOnce(() => Promise.resolve(expectedResponse));
  const promiseSpy = sinon.spy();
  const stub = sinon.stub(awsServices, 'sfn')
    .returns({
      describeExecution: () => {
        promiseSpy();
        return promise();
      },
    });

  try {
    const response = await StepFunctions.describeExecution();
    t.deepEqual(response, expectedResponse);
    t.is(promiseSpy.callCount, 2);
  } finally {
    stub.restore();
  }
});

test.serial('listExecutions() retries if a ThrottlingException occurs', async (t) => {
  const expectedResponse = { events: [{ test: 'test1' }] };
  const promise = throttleOnce(() => Promise.resolve(expectedResponse));
  const promiseSpy = sinon.spy();
  const stub = sinon.stub(awsServices, 'sfn')
    .returns({
      listExecutions: () => {
        promiseSpy();
        return promise();
      },
    });

  try {
    const response = await StepFunctions.listExecutions();
    t.deepEqual(response, expectedResponse);
    t.is(promiseSpy.callCount, 2);
  } finally {
    stub.restore();
  }
});

test.serial('describeStateMachine() retries if a ThrottlingException occurs', async (t) => {
  const expectedResponse = { events: [{ test: 'test1' }] };
  const promise = throttleOnce(() => Promise.resolve(expectedResponse));
  const promiseSpy = sinon.spy();
  const stub = sinon.stub(awsServices, 'sfn')
    .returns({
      describeStateMachine: () => {
        promiseSpy();
        return promise();
      },
    });

  try {
    const response = await StepFunctions.describeStateMachine();
    t.deepEqual(response, expectedResponse);
    t.is(promiseSpy.callCount, 2);
  } finally {
    stub.restore();
  }
});

test('doesExecutionExist() returns true if the Promise resolves', async (t) => {
  t.true(await StepFunctions.doesExecutionExist(Promise.resolve()));
});

test('doesExecutionExist() returns false if the Promise rejects with an ExecutionDoesNotExist name', async (t) => {
  const err = new Error();
  err.name = 'ExecutionDoesNotExist';

  t.false(await StepFunctions.doesExecutionExist(Promise.reject(err)));
});

test('doesExecutionExist() throws any non-ExecutionDoesNotExist errors', async (t) => {
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

test('getExecutionStatus() throws exception if the execution does not exist', async (t) => {
  const executionArn = 'arn:aws:states:us-east-1:123456789012:execution:MyStackIngestAndPublishGranuleStateMachine:c154d37a-98e5-4ca9-9653-35f4ae9b59d3';

  try {
    await StepFunctions.getExecutionStatus(executionArn);
    t.fail();
  } catch (error) {
    t.pass();
  }
});

test.serial('getExecutionStatus() retries if a ThrottlingException occurs in describeExecution, getExecutionHistory and describeStateMachine', async (t) => {
  const expectedResponse = { events: [{ test: 'test1' }] };
  const promise1 = throttleOnce(() => Promise.resolve(expectedResponse));
  const promise2 = throttleOnce(() => Promise.resolve(expectedResponse));
  const promise3 = throttleOnce(() => Promise.resolve(expectedResponse));
  const promiseSpy = sinon.spy();
  const stub = sinon.stub(awsServices, 'sfn')
    .returns({
      describeExecution: () => {
        promiseSpy();
        return promise1();
      },
      getExecutionHistory: () => {
        promiseSpy();
        return promise2();
      },
      describeStateMachine: () => {
        promiseSpy();
        return promise3();
      },
    });

  try {
    const fullExpectedResponse = {
      execution: expectedResponse,
      executionHistory: expectedResponse,
      stateMachine: expectedResponse,
    };

    const response = await StepFunctions.getExecutionStatus();
    t.deepEqual(response, fullExpectedResponse);
    t.is(promiseSpy.callCount, 6);
  } finally {
    stub.restore();
  }
});

test.serial('getExecutionHistory() continues gracefully when sfn().getExecutionHistory returns null', async (t) => {
  const expectedResponse = { events: null };
  const promise = throttleOnce(() => Promise.resolve(expectedResponse));
  const promiseSpy = sinon.spy();
  const stub = sinon.stub(awsServices, 'sfn')
    .returns({
      getExecutionHistory: () => {
        promiseSpy();
        return promise();
      },
    });

  try {
    const response = await StepFunctions.getExecutionHistory();
    t.deepEqual(response, expectedResponse);
    t.is(promiseSpy.callCount, 2);
  } finally {
    stub.restore();
  }
});
