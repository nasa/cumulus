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
  startTime
}) => ({
  cumulus_meta: {
    state_machine: stateMachine,
    execution_name: executionName,
    workflow_start_time: startTime
  },
  meta: {
    status
  }
});

const createExecutionSnsMessage = ({
  status,
  stateMachine,
  executionName,
  startTime
}) => ({
  Sns: {
    Message: JSON.stringify(
      createExecutionMessage({
        status,
        stateMachine,
        executionName,
        startTime
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

test('getReportExecutionMessages returns correct number of tasks', (t) => {
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
      { }
    ]
  });
  t.is(tasks.length, 2);
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
        status: 'running'
      })
    ]
  });

  t.true(await executionsModel.exists({ arn }));
});

test('handler throws error for updated to non-existent execution', async (t) => {
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

test('handler correctly updates completed execution record', async (t) => {
  const stateMachine = randomId('stateMachine');
  const executionName = randomString();
  const arn = getExecutionArn(stateMachine, executionName);

  const startTime = Date.now();
  const status = 'completed';

  await executionsModel.createExecutionFromSns(
    createExecutionMessage({
      stateMachine,
      executionName,
      status: 'running',
      startTime
    })
  );
  const originalExecution = await executionsModel.get({ arn });

  await handler({
    Records: [
      createExecutionSnsMessage({
        stateMachine,
        executionName,
        startTime,
        status
      })
    ]
  });

  const updatedExecution = await executionsModel.get({ arn });
  const expectedResponse = {
    ...originalExecution,
    status,
    duration: updatedExecution.duration,
    timestamp: updatedExecution.timestamp,
    updatedAt: updatedExecution.updatedAt
  };

  t.deepEqual(updatedExecution, expectedResponse);
});

test('handler correctly updates failed execution record', async (t) => {
  const stateMachine = randomId('stateMachine');
  const executionName = randomString();
  const arn = getExecutionArn(stateMachine, executionName);

  const startTime = Date.now();
  const status = 'failed';

  await executionsModel.createExecutionFromSns(
    createExecutionMessage({
      stateMachine,
      executionName,
      status: 'running',
      startTime
    })
  );
  const originalExecution = await executionsModel.get({ arn });

  await handler({
    Records: [
      createExecutionSnsMessage({
        stateMachine,
        executionName,
        startTime,
        status
      })
    ]
  });

  const updatedExecution = await executionsModel.get({ arn });
  const expectedResponse = {
    ...originalExecution,
    status,
    duration: updatedExecution.duration,
    timestamp: updatedExecution.timestamp,
    updatedAt: updatedExecution.updatedAt
  };

  t.deepEqual(updatedExecution, expectedResponse);
});
