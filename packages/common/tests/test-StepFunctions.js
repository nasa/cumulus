'use strict';

const test = require('ava');
const aws = require('../aws');
const StepFunctions = require('../StepFunctions');
const { throttleOnce } = require('../test-utils');

test.serial('getExecutionHistory() retries if a ThrottlingException occurs', async (t) => {
  const sfnBefore = aws.sfn;
  try {
    // Stub out aws.sfn().getExecutionHistory so that it will throw a ThrottlingException
    const promise = throttleOnce(() => Promise.resolve(5));

    aws.sfn = () => ({
      getExecutionHistory: () => ({ promise })
    });

    t.is(await StepFunctions.getExecutionHistory(), 5);
  }
  finally {
    aws.sfn = sfnBefore;
  }
});

test.serial('describeExecution() retries if a ThrottlingException occurs', async (t) => {
  const sfnBefore = aws.sfn;
  try {
    // Stub out aws.sfn().describeExecution so that it will throw a ThrottlingException
    const promise = throttleOnce(() => Promise.resolve(5));

    aws.sfn = () => ({
      describeExecution: () => ({ promise })
    });

    t.is(await StepFunctions.describeExecution(), 5);
  }
  finally {
    aws.sfn = sfnBefore;
  }
});

test.serial('listExecutions() retries if a ThrottlingException occurs', async (t) => {
  const sfnBefore = aws.sfn;
  try {
    // Stub out aws.sfn().listExecutions so that it will throw a ThrottlingException
    const promise = throttleOnce(() => Promise.resolve(5));

    aws.sfn = () => ({
      listExecutions: () => ({ promise })
    });

    t.is(await StepFunctions.listExecutions(), 5);
  }
  finally {
    aws.sfn = sfnBefore;
  }
});

test.serial('describeStateMachine() retries if a ThrottlingException occurs', async (t) => {
  const sfnBefore = aws.sfn;
  try {
    // Stub out aws.sfn().describeStateMachine so that it will throw a ThrottlingException
    const promise = throttleOnce(() => Promise.resolve(5));

    aws.sfn = () => ({
      describeStateMachine: () => ({ promise })
    });

    t.is(await StepFunctions.describeStateMachine(), 5);
  }
  finally {
    aws.sfn = sfnBefore;
  }
});
