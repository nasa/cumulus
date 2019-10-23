'use strict';

const test = require('ava');
const sinon = require('sinon');
const isObject = require('lodash.isobject');

const { ActivityStep, LambdaStep } = require('../sfnStep');
const StepFunctions = require('../StepFunctions');
const { randomId } = require('../test-utils');

const ingestGranuleFailHistory = require('./data/ingest_granule_fail_history.json');
const ingestPublishGranuleFailHistory = require('./data/ingest_publish_granule_fail_history.json');

const failedStepOutput = {
  error: 'Error',
  cause: '{\"errorMessage\":\"{\\\"errorMessage\\\":\\\"CMR Error: Invalid username or password, please retry.\\\",\\\"errorType\\\":\\\"Error\\\",\\\"stackTrace\\\":[\\\"updateToken (/var/task/index.js:437:41)\\\",\\\"<anonymous>\\\",\\\"process._tickDomainCallback (internal/process/next_tick.js:228:7)\\\"]}\",\"errorType\":\"Error\",\"stackTrace\":[\"buildError (/var/task/index.js:20549:10)\",\"makeLambdaFunctionFail (/var/task/index.js:20564:20)\",\"publishSnsMessage (/var/task/index.js:20618:5)\",\"<anonymous>\",\"process._tickDomainCallback (internal/process/next_tick.js:228:7)\"]}'
};

const failedStepException = {
  error: 'Error',
  cause: '{\"errorMessage\":\"{\\\"errorMessage\\\":\\\"CMR Error: Invalid username or password, please retry.\\\",\\\"errorType\\\":\\\"Error\\\",\\\"stackTrace\\\":[\\\"updateToken (/var/task/index.js:437:41)\\\",\\\"<anonymous>\\\",\\\"process._tickDomainCallback (internal/process/next_tick.js:228:7)\\\"]}\",\"errorType\":\"Error\",\"stackTrace\":[\"buildError (/var/task/index.js:20549:10)\",\"makeLambdaFunctionFail (/var/task/index.js:20564:20)\",\"publishSnsMessage (/var/task/index.js:20618:5)\",\"<anonymous>\",\"process._tickDomainCallback (internal/process/next_tick.js:228:7)\"]}'
};

const createFakeExecutionHistory = ({
  message,
  stepName = randomId('stepName'),
  stepType = 'lambda',
  timestamp = Date.now(),
  failed = true
}) => {
  const isLambdaHistory = stepType === 'lambda';
  const scheduledDetailsKey = isLambdaHistory
    ? 'lambdaFunctionScheduledEventDetails'
    : 'activityScheduledEventDetails';
  const failureDetailsKey = isLambdaHistory
    ? 'lambdaFunctionFailedEventDetails'
    : 'activityFailedEventDetails';

  let completionEventType;
  if (failed) {
    completionEventType = isLambdaHistory ? 'LambdaFunctionFailed' : 'ActivityFailed';
  } else {
    completionEventType = isLambdaHistory ? 'LambdaFunctionSucceeded' : 'ActivitySucceeded';
  }

  return {
    events: [
      {
        timestamp,
        type: isLambdaHistory ? 'LambdaFunctionScheduled' : 'ActivityScheduled',
        id: 30,
        previousEventId: 29,
        [scheduledDetailsKey]: {
          resource: stepName,
          input: JSON.stringify(message)
        }
      },
      {
        timestamp: timestamp + 100,
        type: isLambdaHistory ? 'LambdaFunctionStarted' : 'ActivityStarted',
        id: 31,
        previousEventId: 30
      },
      {
        timestamp: timestamp + 200,
        type: completionEventType,
        id: 32,
        previousEventId: 31,
        [failureDetailsKey]: failedStepOutput
      },
      {
        timestamp: timestamp + 200,
        type: 'TaskStateExited',
        id: 33,
        previousEventId: 32,
        stateExitedEventDetails: {
          name: stepName,
          output: JSON.stringify({
            ...message,
            exception: failedStepException
          })
        }
      }
    ]
  };
};

const createCumulusMessage = ({
  cMetaParams = {},
  payload = {}
} = {}) => ({
  cumulus_meta: {
    execution_name: randomId('execution'),
    state_machine: randomId('ingest-'),
    ...cMetaParams
  },
  payload
});

test.serial('ActivityStep.getFirstFailedStepMessage() does not throw error', async (t) => {
  // execution ARN doesn't matter because we're mocking the call to get
  // execution history
  const executionArn = randomId('execution');

  const getExecutionHistoryStub = sinon.stub(StepFunctions, 'getExecutionHistory')
    .callsFake(() => {
      throw new Error('error');
    });

  try {
    const activityStep = new ActivityStep();
    await t.notThrowsAsync(
      activityStep.getFirstFailedStepMessage(executionArn)
    );
  } finally {
    getExecutionHistoryStub.restore();
  }
});

test.serial('ActivityStep.getFirstFailedStepMessage() returns undefined if failed step cannot be found', async (t) => {
  // execution ARN doesn't matter because we're mocking the call to get
  // execution history
  const executionArn = randomId('execution');

  const message = createCumulusMessage();

  const fakeExecutionHistory = createFakeExecutionHistory({
    message,
    failed: false,
    stepType: 'activity'
  });
  const getExecutionHistoryStub = sinon.stub(StepFunctions, 'getExecutionHistory')
    .callsFake(() => fakeExecutionHistory);

  try {
    const activityStep = new ActivityStep();
    t.is(await activityStep.getFirstFailedStepMessage(executionArn), undefined);
  } finally {
    getExecutionHistoryStub.restore();
  }
});

test.serial('ActivityStep.getFirstFailedStepMessage() returns correct message', async (t) => {
  // execution ARN doesn't matter because we're mocking the call to get
  // execution history
  const executionArn = randomId('execution');
  const message = createCumulusMessage({
    payload: {
      foo: 'bar'
    }
  });

  const stepName = randomId('step');
  const fakeExecutionHistory = createFakeExecutionHistory({
    message,
    stepName,
    stepType: 'activity'
  });
  const getExecutionHistoryStub = sinon.stub(StepFunctions, 'getExecutionHistory')
    .callsFake(() => fakeExecutionHistory);

  try {
    const activityStep = new ActivityStep();
    const failedStepInput = await activityStep.getFirstFailedStepMessage(executionArn);
    const expectedMessage = {
      ...message,
      exception: failedStepException
    };
    t.deepEqual(failedStepInput, expectedMessage);
  } finally {
    getExecutionHistoryStub.restore();
  }
});

test.serial('LambdaStep.getFirstFailedStepMessage() does not throw error', async (t) => {
  // execution ARN doesn't matter because we're mocking the call to get
  // execution history
  const executionArn = randomId('execution');

  const getExecutionHistoryStub = sinon.stub(StepFunctions, 'getExecutionHistory')
    .callsFake(() => {
      throw new Error('error');
    });

  try {
    const lambdaStep = new LambdaStep();
    await t.notThrowsAsync(
      lambdaStep.getFirstFailedStepMessage(executionArn)
    );
  } finally {
    getExecutionHistoryStub.restore();
  }
});

test.serial('LambdaStep.getFirstFailedStepMessage() returns undefined if failed step cannot be found', async (t) => {
  // execution ARN doesn't matter because we're mocking the call to get
  // execution history
  const executionArn = randomId('execution');

  const message = createCumulusMessage();

  const fakeExecutionHistory = createFakeExecutionHistory({
    message,
    failed: false
  });
  const getExecutionHistoryStub = sinon.stub(StepFunctions, 'getExecutionHistory')
    .callsFake(() => fakeExecutionHistory);

  try {
    const lambdaStep = new LambdaStep();
    t.is(await lambdaStep.getFirstFailedStepMessage(executionArn), undefined);
  } finally {
    getExecutionHistoryStub.restore();
  }
});

test.serial('LambdaStep.getFirstFailedStepMessage() returns correct message', async (t) => {
  // execution ARN doesn't matter because we're mocking the call to get
  // execution history
  const executionArn = randomId('execution');
  const message = createCumulusMessage({
    payload: {
      foo: 'bar'
    }
  });

  const stepName = randomId('step');
  const fakeExecutionHistory = createFakeExecutionHistory({
    message,
    stepName
  });
  const getExecutionHistoryStub = sinon.stub(StepFunctions, 'getExecutionHistory')
    .callsFake(() => fakeExecutionHistory);

  try {
    const lambdaStep = new LambdaStep();
    const failedStepInput = await lambdaStep.getFirstFailedStepMessage(executionArn);
    const expectedMessage = {
      ...message,
      exception: failedStepException
    };
    t.deepEqual(failedStepInput, expectedMessage);
  } finally {
    getExecutionHistoryStub.restore();
  }
});

test.serial('gets message exception when failed step retry occurs', async (t) => {
  const getExecutionHistoryStub = sinon.stub(StepFunctions, 'getExecutionHistory')
    .callsFake(() => ingestGranuleFailHistory);

  // execution ARN doesn't matter because we're mocking the call to get
  // execution history
  const executionArn = randomId('execution');

  try {
    const lambdaStep = new LambdaStep();
    const failedStepMessage = await lambdaStep.getFirstFailedStepMessage(executionArn);
    t.true(isObject(failedStepMessage.exception));
    t.is(failedStepMessage.exception.Error, 'FileNotFound');
  } finally {
    getExecutionHistoryStub.restore();
  }
});

test.serial('gets message exception when no step retry occurs', async (t) => {
  const getExecutionHistoryStub = sinon.stub(StepFunctions, 'getExecutionHistory')
    .callsFake(() => ingestPublishGranuleFailHistory);

  // execution ARN doesn't matter because we're mocking the call to get
  // execution history
  const executionArn = randomId('execution');

  try {
    const lambdaStep = new LambdaStep();
    const failedStepMessage = await lambdaStep.getFirstFailedStepMessage(executionArn);
    t.true(isObject(failedStepMessage.exception));
    t.is(failedStepMessage.exception.Error, 'CumulusMessageAdapterExecutionError');
  } finally {
    getExecutionHistoryStub.restore();
  }
});
