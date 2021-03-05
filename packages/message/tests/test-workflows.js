'use strict';

const test = require('ava');

const { getMessageWorkflowStartTime } = require('../workflows');

test('getMessageWorkflowStartTime returns the workflow start time', (t) => {
  const testMessage = {
    cumulus_meta: {
      workflow_start_time: 123456,
    },
  };
  const result = getMessageWorkflowStartTime(testMessage);
  t.is(result, 123456);
});

test('getMessageWorkflowStartTime throws when a start time is not present in the message', (t) => {
  const testMessage = {};
  t.throws(() => getMessageWorkflowStartTime(testMessage));
});
