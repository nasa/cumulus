const test = require('ava');

const { getReportExecutionTasks } = require('..');

const createExecutionSnsMessage = (status) => ({
  Sns: {
    Message: JSON.stringify({
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
    Sns: {}
  }]);
  t.is(messages.length, 0);

  messages = getReportExecutionTasks([{
    Sns: {
      Message: 'message'
    }
  }]);
  t.is(messages.length, 0);

  messages = getReportExecutionTasks([{
    Sns: {
      Message: JSON.stringify({
        meta: {}
      })
    }
  }]);
  t.is(messages.length, 0);
});

test('getReportExecutionTasks returns correct number of tasks', (t) => {
  const tasks = getReportExecutionTasks([
    createExecutionSnsMessage('completed'),
    createExecutionSnsMessage('failed'),
    { }
  ]);
  t.is(tasks.length, 2);
});
