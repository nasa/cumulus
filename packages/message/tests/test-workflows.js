'use strict';

const test = require('ava');

const {
  getMetaStatus,
  getMessageWorkflowTasks,
  getMessageWorkflowStartTime,
  getMessageWorkflowStopTime,
  getMessageWorkflowName,
  getWorkflowDuration,
} = require('../workflows');

test('getMetaStatus returns correct status', (t) => {
  const status = getMetaStatus({
    meta: {
      status: 'running',
    },
  });
  t.is(status, 'running');
});

test('getMetaStatus returns undefined if there is no status', (t) => {
  const status = getMetaStatus({
    meta: {},
  });
  t.is(status, undefined);
});

test('getMessageWorkflowTasks returns correct map of workflow tasks', (t) => {
  const tasks = {
    task1: {
      foo: 'bar',
    },
  };
  t.deepEqual(
    getMessageWorkflowTasks({
      meta: {
        workflow_tasks: tasks,
      },
    }),
    tasks
  );
});

test('getMessageWorkflowTasks returns undefined if there is no task information on the message', (t) => {
  t.is(
    getMessageWorkflowTasks({}),
    undefined
  );
});

test('getMessageWorkflowStartTime returns correct value', (t) => {
  const time = Date.now();
  t.is(
    getMessageWorkflowStartTime({
      cumulus_meta: {
        workflow_start_time: time,
      },
    }),
    time
  );
});

test('getMessageWorkflowStartTime throws when a start time is not present in the message', (t) => {
  const testMessage = {};
  t.throws(() => getMessageWorkflowStartTime(testMessage));
});

test('getMessageWorkflowStartTime returns undefined if there is no start time', (t) => {
  t.is(
    getMessageWorkflowStartTime({}),
    undefined
  );
});

test('getMessageWorkflowStopTime returns correct value', (t) => {
  const time = Date.now();
  t.is(
    getMessageWorkflowStopTime({
      cumulus_meta: {
        workflow_stop_time: time,
      },
    }),
    time
  );
});

test('getMessageWorkflowStopTime returns undefined if there is no stop time', (t) => {
  t.is(
    getMessageWorkflowStopTime({}),
    undefined
  );
});

test('getMessageWorkflowName returns correct value', (t) => {
  const workflowName = 'fake-workflow';
  t.is(
    getMessageWorkflowName({
      meta: {
        workflow_name: workflowName,
      },
    }),
    workflowName
  );
});

test('getMessageWorkflowName returns undefined if there is no workflow name', (t) => {
  t.is(
    getMessageWorkflowName({}),
    undefined
  );
});

test('getWorkflowDuration returns correct duration', (t) => {
  const now = Date.now();
  t.is(
    getWorkflowDuration(
      now,
      now + 1000
    ),
    1
  );
});

test('getWorkflowDuration 0 if no stop time is provided', (t) => {
  t.is(
    getWorkflowDuration(
      Date.now()
    ),
    0
  );
});
