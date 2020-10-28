'use strict';

const test = require('ava');

const {
  getWorkflowStatus,
} = require('../workflows');

test('getWorkflowStatus returns correct status', (t) => {
  const status = getWorkflowStatus({
    meta: {
      status: 'running',
    },
  });
  t.is(status, 'running');
});

test('getWorkflowStatus returns undefined if there is no status', (t) => {
  const status = getWorkflowStatus({
    meta: {},
  });
  t.is(status, undefined);
});
