'use strict';

const test = require('ava');

const {
  getWorkflowStatus,
} = require('../workflows');

test('getWorkflowStatus returns correct status', (t) => {
  const asyncOperationId = getWorkflowStatus({
    meta: {
      status: 'running',
    },
  });
  t.is(asyncOperationId, 'running');
});

test('getWorkflowStatus returns undefined if there is no status', (t) => {
  const asyncOperationId = getWorkflowStatus({
    meta: {},
  });
  t.is(asyncOperationId, undefined);
});
