const test = require('ava');

const { isFailedSfStatus, isTerminalSfStatus } = require('../cloudwatch-event');

test('isTerminalSfStatus returns true for terminal Step Function statuses', (t) => {
  t.true(isTerminalSfStatus('ABORTED'));
  t.true(isTerminalSfStatus('SUCCEEDED'));
  t.true(isTerminalSfStatus('FAILED'));
  t.true(isTerminalSfStatus('TIMED_OUT'));
});

test('isTerminalSfStatus returns false for non-terminal Step Function statuses', (t) => {
  t.false(isTerminalSfStatus('RUNNING'));
  t.false(isTerminalSfStatus('random-status'));
});

test('isFailedSfStatus returns true for failed Step Function statuses', (t) => {
  t.true(isFailedSfStatus('ABORTED'));
  t.true(isFailedSfStatus('FAILED'));
  t.true(isFailedSfStatus('TIMED_OUT'));
});

test('isFailedSfStatus returns false for failed Step Function statuses', (t) => {
  t.false(isFailedSfStatus('SUCCEEDED'));
  t.false(isFailedSfStatus('RUNNING'));
  t.false(isFailedSfStatus('random-status'));
});
