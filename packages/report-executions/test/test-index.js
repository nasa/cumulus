'use strict';

const test = require('ava');

const { Execution } = require('@cumulus/api/models');
const { getExecutionArn } = require('@cumulus/common/aws');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const { RecordDoesNotExist } = require('@cumulus/common/errors');

const { getReportExecutionMessages, handler } = require('..');

const createExecutionMessage = ({
  status,
  stateMachine,
  executionName,
  startTime,
  payload,
  collection
}) => ({
  cumulus_meta: {
    state_machine: stateMachine,
    execution_name: executionName,
    workflow_start_time: startTime
  },
  meta: {
    collection,
    status
  },
  payload
});

const createExecutionSnsMessage = ({
  status,
  stateMachine,
  executionName,
  startTime,
  payload,
  collection
}) => ({
  Sns: {
    Message: JSON.stringify(
      createExecutionMessage({
        status,
        stateMachine,
        executionName,
        startTime,
        payload,
        collection
      })
    )
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
  t.context.startTime = Date.now();
  t.context.collection = {
    name: 'fake-collection',
    version: '001'
  };
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

test('getReportExecutionMessages returns no tasks for non-execution messages', (t) => {
  let messages = getReportExecutionMessages([{}]);
  t.is(messages.length, 0);

  messages = getReportExecutionMessages([{
    Records: [{
      Sns: {}
    }]
  }]);
  t.is(messages.length, 0);

  messages = getReportExecutionMessages([{
    Records: [{
      Sns: {
        Message: 'message'
      }
    }]
  }]);
  t.is(messages.length, 0);

  messages = getReportExecutionMessages([{
    Records: [{
      Sns: {
        Message: JSON.stringify({
          meta: {}
        })
      }
    }]
  }]);
  t.is(messages.length, 0);
});

test('getReportExecutionMessages returns correct number of messages', (t) => {
  const stateMachine = randomId('stateMachine');
  const executionName = randomId('execution');

  const tasks = getReportExecutionMessages({
    Records: [
      createExecutionSnsMessage({
        stateMachine,
        executionName,
        status: 'completed'
      }),
      createExecutionSnsMessage({
        stateMachine,
        executionName,
        status: 'failed'
      }),
      createExecutionSnsMessage({
        stateMachine,
        executionName,
        status: 'running'
      }),
      createExecutionSnsMessage({
        stateMachine,
        executionName
      }),
      { }
    ]
  });
  t.is(tasks.length, 3);
});

test('handler correctly creates execution record', async (t) => {
  const stateMachine = randomId('stateMachine');
  const executionName = randomString();
  const arn = getExecutionArn(stateMachine, executionName);

  await handler({
    Records: [
      createExecutionSnsMessage({
        stateMachine,
        executionName,
        status: 'running',
        startTime: Date.now()
      })
    ]
  });

  t.true(await executionsModel.exists({ arn }));
});

test('handler throws error for update to non-existent execution', async (t) => {
  const stateMachine = randomId('stateMachine');
  const executionName = randomString();

  await t.throwsAsync(
    () => handler({
      Records: [
        createExecutionSnsMessage({
          stateMachine,
          executionName,
          status: 'completed'
        })
      ]
    }),
    { instanceOf: RecordDoesNotExist }
  );
});

const testExecutionUpdate = async (t, status) => {
  const {
    arn,
    collection,
    executionName,
    finalPayload,
    originalPayload,
    startTime,
    stateMachine
  } = t.context;

  await executionsModel.createExecutionFromSns(
    createExecutionMessage({
      collection,
      executionName,
      payload: originalPayload,
      startTime,
      stateMachine,
      status: 'running'
    })
  );
  const originalExecution = await executionsModel.get({ arn });

  await handler({
    Records: [
      createExecutionSnsMessage({
        collection,
        executionName,
        payload: finalPayload,
        startTime,
        stateMachine,
        status
      })
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
  const completedStateMachine = randomId('stateMachine');
  const completedExecutionName = randomString();
  const completedExecutionArn = getExecutionArn(completedStateMachine, completedExecutionName);
  const completedExecutionStatus = 'completed';

  const failedExecutionStateMachine = randomId('stateMachine');
  const failedExecutionName = randomString();
  const failedExecutionArn = getExecutionArn(failedExecutionStateMachine, failedExecutionName);
  const failedExecutionStatus = 'failed';

  const startTime = Date.now();

  await Promise.all([
    executionsModel.createExecutionFromSns(
      createExecutionMessage({
        stateMachine: completedStateMachine,
        executionName: completedExecutionName,
        status: 'running',
        startTime
      })
    ),
    executionsModel.createExecutionFromSns(
      createExecutionMessage({
        stateMachine: failedExecutionStateMachine,
        executionName: failedExecutionName,
        status: 'running',
        startTime
      })
    )
  ]);

  const originalCompletedExecution = await executionsModel.get({ arn: completedExecutionArn });
  const originalFailedExecution = await executionsModel.get({ arn: failedExecutionArn });

  await handler({
    Records: [
      createExecutionSnsMessage({
        stateMachine: completedStateMachine,
        executionName: completedExecutionName,
        startTime,
        status: completedExecutionStatus
      }),
      createExecutionSnsMessage({
        stateMachine: failedExecutionStateMachine,
        executionName: failedExecutionName,
        startTime,
        status: failedExecutionStatus
      })
    ]
  });

  const updatedCompletedExecution = await executionsModel.get({ arn: completedExecutionArn });

  const expectedCompletedExecutionResponse = {
    ...originalCompletedExecution,
    status: completedExecutionStatus,
    duration: updatedCompletedExecution.duration,
    timestamp: updatedCompletedExecution.timestamp,
    updatedAt: updatedCompletedExecution.updatedAt
  };

  t.deepEqual(updatedCompletedExecution, expectedCompletedExecutionResponse);

  const updatedFailedExecution = await executionsModel.get({ arn: failedExecutionArn });
  const expectedFailedExecutionResponse = {
    ...originalFailedExecution,
    status: failedExecutionStatus,
    duration: updatedFailedExecution.duration,
    timestamp: updatedFailedExecution.timestamp,
    updatedAt: updatedFailedExecution.updatedAt
  };

  t.deepEqual(updatedFailedExecution, expectedFailedExecutionResponse);
});
