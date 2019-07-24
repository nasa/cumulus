'use strict';

const test = require('ava');

const { randomId } = require('@cumulus/common/test-utils');
const { Execution } = require('@cumulus/api/models');

const { getReportExecutionMessages, handler } = require('..');

const createExecutionSnsMessage = ({
  status,
  stateMachine,
  executionName
}) => ({
  Sns: {
    Message: JSON.stringify({
      cumulus_meta: {
        state_machine: stateMachine,
        execution_name: executionName
      },
      meta: {
        status
      }
    })
  }
});

let executionModel;

test.before(async () => {
  process.env.ExecutionsTable = randomId('executionsTable');
  executionModel = new Execution();
  await executionModel.createTable();
});

test.after.always(async () => {
  await executionModel.deleteTable();
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

test.skip('handler correctly creates execution record', async (t) => {
  const stateMachine = 'stateMachine';
  const executionName = 'execution1';
  const arn = `${stateMachine}:${executionName}`;

  const response = await executionsModel.exists({ arn });
  debugger;

  await handler({
    Records: [
      createExecutionSnsMessage({
        stateMachine,
        executionName
      })
    ]
  });

  t.true(await executionsModel.exists({ arn }));
});
