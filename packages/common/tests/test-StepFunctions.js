'use strict';

const test = require('ava');
const aws = require('../aws');
const StepFunctions = require('../StepFunctions');
const { throttleOnce } = require('../test-utils');

const runWithStubbedAndThrottledSfnOperation = async (operation, response, fn) => {
  const sfnBefore = aws.sfn;
  try {
    const promise = throttleOnce(() => Promise.resolve(response));

    aws.sfn = () => ({
      [operation]: () => ({ promise })
    });

    return await fn();
  }
  finally {
    aws.sfn = sfnBefore;
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
