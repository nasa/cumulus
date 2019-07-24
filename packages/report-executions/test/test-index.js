'use strict';

const test = require('ava');

const { getReportExecutionTasks, handler } = require('..');

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

test('getReportExecutionTasks returns no tasks for non-execution messages', (t) => {
  let messages = getReportExecutionTasks([{}]);
  t.is(messages.length, 0);

  messages = getReportExecutionTasks([{
    Records: [{
      Sns: {}
    }]
  }]);
  t.is(messages.length, 0);

  messages = getReportExecutionTasks([{
    Records: [{
      Sns: {
        Message: 'message'
      }
    }]
  }]);
  t.is(messages.length, 0);

  messages = getReportExecutionTasks([{
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

test('getReportExecutionTasks returns correct number of tasks', (t) => {
  const tasks = getReportExecutionTasks({
    Records: [
      createExecutionSnsMessage({ status: 'completed' }),
      createExecutionSnsMessage({ status: 'failed' }),
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
