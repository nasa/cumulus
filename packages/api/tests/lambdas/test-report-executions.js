'use strict';

const test = require('ava');

const { getExecutionArn } = require('@cumulus/common/aws');
const { randomId, randomNumber, randomString } = require('@cumulus/common/test-utils');

const Execution = require('../../models/executions');
const { getReportExecutionMessages, handler } = require('../../lambdas/report-executions');

const fakeExecutionRecord = {
  name: randomString(),
  arn: randomString(),
  collectionId: randomId('collection'),
  status: 'completed',
  execution: randomString(),
  error: {
    Error: 'Error',
    Cause: 'Workflow failed'
  },
  createdAt: Date.now(),
  duration: 10000000,
  timestamp: Date.now() - randomNumber(10000000)
};

const createFakeExecutionRecord = (granuleParams) => ({
  ...fakeExecutionRecord,
  ...granuleParams
});

const createExecutionSnsMessage = (message) => ({
  EventSource: 'aws:sns',
  Sns: {
    Message: JSON.stringify(message)
  }
});

let executionsModel;

test.before(async () => {
  process.env.ExecutionsTable = randomId('executionsTable');
  executionsModel = new Execution();
  await executionsModel.createTable();
});

test.beforeEach((t) => {
  t.context.stateMachine = randomId('stateMachine');
  t.context.executionName = randomString();
  t.context.arn = getExecutionArn(t.context.stateMachine, t.context.executionName);
  t.context.createdAtTime = Date.now();
  t.context.collectionId = randomId('collection');
  t.context.originalPayload = {
    foo: 'bar'
  };
  t.context.finalPayload = {
    test: randomString()
  };
});

test.after.always(async () => {
  await executionsModel.deleteTable();
});

test('getReportExecutionMessages returns correct number of messages', (t) => {
  const messages = getReportExecutionMessages({
    Records: [
      createExecutionSnsMessage(
        createFakeExecutionRecord()
      ),
      createExecutionSnsMessage(
        createFakeExecutionRecord()
      ),
      createExecutionSnsMessage(
        createFakeExecutionRecord()
      )
    ]
  });
  t.is(messages.length, 3);
});

test('handler correctly creates execution record', async (t) => {
  const { arn } = t.context;

  await handler({
    Records: [
      createExecutionSnsMessage(createFakeExecutionRecord({
        arn,
        status: 'running'
      }))
    ]
  });

  const record = await executionsModel.get({ arn });
  t.is(record.status, 'running');
});

const testExecutionUpdate = async (t, status) => {
  const {
    arn,
    collectionId,
    executionName,
    finalPayload,
    originalPayload,
    createdAtTime
  } = t.context;

  const record = createFakeExecutionRecord({
    arn,
    collectionId,
    name: executionName,
    originalPayload,
    status: 'running',
    createdAt: createdAtTime
  });

  await executionsModel.create(record);
  const originalExecution = await executionsModel.get({ arn });

  record.status = status;
  record.finalPayload = finalPayload;

  await handler({
    Records: [
      createExecutionSnsMessage(record)
    ]
  });

  const updatedExecution = await executionsModel.get({ arn });
  const expectedResponse = {
    ...originalExecution,
    finalPayload,
    status,
    duration: updatedExecution.duration,
    timestamp: updatedExecution.timestamp,
    updatedAt: updatedExecution.updatedAt
  };

  t.deepEqual(updatedExecution, expectedResponse);
};

test('handler correctly updates completed execution record', async (t) => {
  const status = 'completed';
  await testExecutionUpdate(t, status);
});

test('handler correctly updates failed execution record', async (t) => {
  const status = 'failed';
  await testExecutionUpdate(t, status);
});

test('handler correctly updates multiple records', async (t) => {
  const completedExecutionArn = getExecutionArn(randomId('stateMachine'), randomString());
  const completedExecutionStatus = 'completed';

  const failedExecutionArn = getExecutionArn(randomId('stateMachine'), randomString());
  const failedExecutionStatus = 'failed';

  const startTime = Date.now();
  const initialExecutionRecord = createFakeExecutionRecord({
    arn: completedExecutionArn,
    status: 'running',
    createdAt: startTime
  });

  await Promise.all([
    executionsModel.create({
      ...initialExecutionRecord,
      arn: completedExecutionArn
    }),
    executionsModel.create({
      ...initialExecutionRecord,
      arn: failedExecutionArn
    })
  ]);

  const originalCompletedExecution = await executionsModel.get({ arn: completedExecutionArn });
  const originalFailedExecution = await executionsModel.get({ arn: failedExecutionArn });

  await handler({
    Records: [
      createExecutionSnsMessage({
        ...originalCompletedExecution,
        status: completedExecutionStatus
      }),
      createExecutionSnsMessage({
        ...originalFailedExecution,
        status: failedExecutionStatus
      })
    ]
  });

  const updatedCompletedExecution = await executionsModel.get({ arn: completedExecutionArn });

  const expectedCompletedExecutionResponse = {
    ...originalCompletedExecution,
    status: completedExecutionStatus,
    updatedAt: updatedCompletedExecution.updatedAt
  };

  t.deepEqual(updatedCompletedExecution, expectedCompletedExecutionResponse);

  const updatedFailedExecution = await executionsModel.get({ arn: failedExecutionArn });
  const expectedFailedExecutionResponse = {
    ...originalFailedExecution,
    status: failedExecutionStatus,
    updatedAt: updatedFailedExecution.updatedAt
  };

  t.deepEqual(updatedFailedExecution, expectedFailedExecutionResponse);
});
