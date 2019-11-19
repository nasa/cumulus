'use strict';

const test = require('ava');
const sinon = require('sinon');
const isObject = require('lodash.isobject');

const { ActivityStep, LambdaStep } = require('../sfnStep');
const StepFunctions = require('../StepFunctions');
const { randomId, randomNumber } = require('../test-utils');

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
  completedStepId = randomNumber(),
  stepName = randomId('stepName'),
  stepType = 'lambda',
  timestamp = Date.now(),
  failed = true,
  finalEventType = 'taskExit'
}) => {
  const isLambdaHistory = stepType === 'lambda';
  const scheduledDetailsKey = isLambdaHistory
    ? 'lambdaFunctionScheduledEventDetails'
    : 'activityScheduledEventDetails';

  let completedDetailsKey;
  let completionEventType;
  if (failed) {
    completedDetailsKey = isLambdaHistory ? 'lambdaFunctionFailedEventDetails' : 'activityFailedEventDetails';
    completionEventType = isLambdaHistory ? 'LambdaFunctionFailed' : 'ActivityFailed';
  } else {
    completedDetailsKey = isLambdaHistory ? 'lambdaFunctionSucceededEventDetails' : 'activitySucceededEventDetails';
    completionEventType = isLambdaHistory ? 'LambdaFunctionSucceeded' : 'ActivitySucceeded';
  }

  const events = [
    {
      timestamp,
      type: isLambdaHistory ? 'LambdaFunctionScheduled' : 'ActivityScheduled',
      [scheduledDetailsKey]: {
        resource: stepName,
        input: JSON.stringify(message)
      }
    },
    {
      timestamp: timestamp + 100,
      type: isLambdaHistory ? 'LambdaFunctionStarted' : 'ActivityStarted'
    },
    {
      timestamp: timestamp + 200,
      type: completionEventType,
      id: completedStepId,
      [completedDetailsKey]: failed ? failedStepOutput : {}
    }
  ];

  if (finalEventType === 'taskExit') {
    const additionalOutput = failed
      ? { exception: failedStepException }
      : {};
    events.push({
      timestamp: timestamp + 200,
      type: 'TaskStateExited',
      id: completedStepId + 1,
      previousEventId: completedStepId,
      stateExitedEventDetails: {
        name: stepName,
        output: JSON.stringify({
          ...message,
          ...additionalOutput
        })
      }
    });
  } else if (finalEventType === 'executionFail') {
    events.push({
      timestamp: timestamp + 200,
      type: 'ExecutionFailed',
      id: completedStepId + 1,
      previousEventId: completedStepId,
      executionFailedEventDetails: failedStepException
    });
  }

  return {
    events
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

test.beforeEach((t) => {
  t.context.completedStepId = randomNumber();
  t.context.invalidFailedStepId = randomNumber();
  // Ensure that the invalid failed step ID does not match an event ID
  // in the execution history
  while (t.context.completedStepId === t.context.invalidFailedStepId) {
    t.context.invalidFailedStepId = randomNumber();
  }
});

test.serial('ActivityStep.getLastFailedStepEvent() throws error if failed step cannot be found', async (t) => {
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
    await t.throwsAsync(activityStep.getLastFailedStepEvent(executionArn));
  } finally {
    getExecutionHistoryStub.restore();
  }
});

test.serial('ActivityStep.getLastFailedStepOutput() throws error if output from failed step cannot be found', async (t) => {
  const { completedStepId, invalidFailedStepId } = t.context;
  // execution ARN doesn't matter because we're mocking the call to get
  // execution history
  const executionArn = randomId('execution');

  const message = createCumulusMessage();
  const fakeExecutionHistory = createFakeExecutionHistory({
    message,
    failed: false,
    stepType: 'activity',
    completedStepId
  });
  const getExecutionHistoryStub = sinon.stub(StepFunctions, 'getExecutionHistory')
    .callsFake(() => fakeExecutionHistory);

  try {
    const activityStep = new ActivityStep();
    await t.throwsAsync(
      activityStep.getLastFailedStepOutput(
        fakeExecutionHistory.events,
        executionArn,
        invalidFailedStepId
      )
    );
  } finally {
    getExecutionHistoryStub.restore();
  }
});

test.serial('ActivityStep.getLastFailedStepOutput() returns correct message', async (t) => {
  // execution ARN doesn't matter because we're mocking the call to get
  // execution history
  const executionArn = randomId('execution');
  const message = createCumulusMessage({
    payload: {
      foo: 'bar'
    }
  });

  const stepName = randomId('step');
  const completedStepId = randomNumber();
  const fakeExecutionHistory = createFakeExecutionHistory({
    message,
    stepName,
    stepType: 'activity',
    completedStepId
  });
  const getExecutionHistoryStub = sinon.stub(StepFunctions, 'getExecutionHistory')
    .callsFake(() => fakeExecutionHistory);

  try {
    const activityStep = new ActivityStep();
    const failedStepInput = await activityStep.getLastFailedStepOutput(
      fakeExecutionHistory.events,
      executionArn,
      completedStepId
    );
    const expectedMessage = {
      ...message,
      exception: failedStepException
    };
    t.deepEqual(failedStepInput, expectedMessage);
  } finally {
    getExecutionHistoryStub.restore();
  }
});

test.serial('LambdaStep.getLastFailedStepEvent() throws error if failed step cannot be found', async (t) => {
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
    await t.throwsAsync(lambdaStep.getLastFailedStepEvent(executionArn));
  } finally {
    getExecutionHistoryStub.restore();
  }
});

test.serial('LambdaStep.getLastFailedStepOutput() throws error if output from failed step cannot be found', async (t) => {
  const { completedStepId, invalidFailedStepId } = t.context;

  // execution ARN doesn't matter because we're mocking the call to get
  // execution history
  const executionArn = randomId('execution');
  const message = createCumulusMessage();
  const fakeExecutionHistory = createFakeExecutionHistory({
    message,
    failed: false,
    stepType: 'activity',
    completedStepId
  });
  const getExecutionHistoryStub = sinon.stub(StepFunctions, 'getExecutionHistory')
    .callsFake(() => fakeExecutionHistory);

  try {
    const lambdaStep = new LambdaStep();
    await t.throwsAsync(
      lambdaStep.getLastFailedStepOutput(
        fakeExecutionHistory.events,
        executionArn,
        invalidFailedStepId
      )
    );
  } finally {
    getExecutionHistoryStub.restore();
  }
});

test.serial('LambdaStep.getLastFailedStepOutput() returns correct message', async (t) => {
  // execution ARN doesn't matter because we're mocking the call to get
  // execution history
  const executionArn = randomId('execution');
  const message = createCumulusMessage({
    payload: {
      foo: 'bar'
    }
  });

  const stepName = randomId('step');
  const completedStepId = randomNumber();
  const fakeExecutionHistory = createFakeExecutionHistory({
    completedStepId,
    message,
    stepName
  });
  const getExecutionHistoryStub = sinon.stub(StepFunctions, 'getExecutionHistory')
    .callsFake(() => fakeExecutionHistory);

  try {
    const lambdaStep = new LambdaStep();
    const failedStepInput = await lambdaStep.getLastFailedStepOutput(
      fakeExecutionHistory.events,
      executionArn,
      completedStepId
    );
    const expectedMessage = {
      ...message,
      exception: failedStepException
    };
    t.deepEqual(failedStepInput, expectedMessage);
  } finally {
    getExecutionHistoryStub.restore();
  }
});

test.serial.skip('LambdaStep.getLastFailedStepOutput() returns correct message for failed workflow with single step', async (t) => {
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
    finalEventType: 'executionFail'
  });
  const getExecutionHistoryStub = sinon.stub(StepFunctions, 'getExecutionHistory')
    .callsFake(() => fakeExecutionHistory);

  try {
    const lambdaStep = new LambdaStep();
    const failedStepInput = await lambdaStep.getLastFailedStepOutput(executionArn);
    const expectedMessage = {
      ...failedStepException
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
    const { failedStepId } = await lambdaStep.getLastFailedStepEvent(executionArn);
    const failedStepMessage = await lambdaStep.getLastFailedStepOutput(
      ingestGranuleFailHistory.events,
      executionArn,
      failedStepId
    );
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
    const { failedStepId } = await lambdaStep.getLastFailedStepEvent(executionArn);
    const failedStepMessage = await lambdaStep.getLastFailedStepOutput(
      ingestPublishGranuleFailHistory.events,
      executionArn,
      failedStepId
    );
    t.true(isObject(failedStepMessage.exception));
    t.is(failedStepMessage.exception.Error, 'CumulusMessageAdapterExecutionError');
  } finally {
    getExecutionHistoryStub.restore();
  }
});
