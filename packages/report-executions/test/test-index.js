const test = require('ava');

const { getReportExecutionTasks } = require('..');

const createExecutionSnsMessage = (status) => ({
  Sns: {
    Message: JSON.stringify({
      cumulus_meta: {
        state_machine: 'fake-state-machine',
        execution_name: 'fake-execution-name'
      },
      meta: {
        status
      }
    })
  }
});

test.before(async () => {
  process.env.ExecutionsTable = 'test-executionsTable';
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
      createExecutionSnsMessage('completed'),
      createExecutionSnsMessage('failed'),
      { }
    ]
  });
  t.is(tasks.length, 2);
});
