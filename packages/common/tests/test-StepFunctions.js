'use strict';

const test = require('ava');
const aws = require('../aws');
const StepFunctions = require('../StepFunctions');
const { throttleOnce } = require('../test-utils');

const runWithStubbedAndThrottledSfnOperation = async (operation, response, fn) => {
  const operationBefore = aws.sfn()[operation];
  try {
    const promise = throttleOnce(() => Promise.resolve(response));

    aws.sfn()[operation] = () => ({ promise });

    return await fn();
  } finally {
    aws.sfn()[operation] = operationBefore;
  }
};

test.serial('getExecutionHistory() retries if a ThrottlingException occurs',
  (t) => runWithStubbedAndThrottledSfnOperation(
    'getExecutionHistory',
    5,
    async () => t.is(await StepFunctions.getExecutionHistory(), 5)
  ));

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
