'use strict';

const sinon = require('sinon');
const test = require('ava');

const { cleanExecutionPayloads } = require('../../lambdas/cleanExecutions');

const removeRecordsStub = sinon.spy();

class executionModel {
  removeOldPayloadRecords(...value) {
    return removeRecordsStub(...value);
  }
}

test.beforeEach(() => {
  process.env.completeExecutionPayloadTimeoutDisable = false;
  process.env.nonCompleteExecutionPayloadTimeoutDisable = false;
});

test.serial('Function is called with correct timeout values', async (t) => {
  process.env.completeExecutionPayloadTimeout = 100;
  process.env.nonCompleteExecutionPayloadTimeout = 50;
  await cleanExecutionPayloads(executionModel);
  t.truthy(removeRecordsStub.calledWith(100, 50, false, false));
});

test.serial('Function returns empty array if passed in values are disabled', async (t) => {
  process.env.completeExecutionPayloadTimeout = 100;
  process.env.nonCompleteExecutionPayloadTimeout = 50;
  process.env.completeExecutionPayloadTimeoutDisable = true;
  process.env.nonCompleteExecutionPayloadTimeoutDisable = true;
  const actual = await cleanExecutionPayloads(executionModel);
  const expected = [];
  t.deepEqual(actual, expected);
});

test.serial('Function throws error if passed invalid complete timeout', async (t) => {
  process.env.nonCompleteExecutionPayloadTimeout = 100;
  process.env.completeExecutionPayloadTimeout = 'notaninteger';
  let actual;
  await cleanExecutionPayloads(executionModel).catch((error) => {
    actual = error.message;
  });
  const expected = 'Invalid number of days specified in configuration for completeExecutionPayloadTimeout: notaninteger';
  t.is(actual, expected);
});

test.serial('Function throws error if passed invalid non-complete timeout', async (t) => {
  process.env.nonCompleteExecutionPayloadTimeout = 'notaninteger';
  process.env.completeExecutionPayloadTimeout = 100;
  let actual;
  await cleanExecutionPayloads(executionModel).catch((error) => {
    actual = error.message;
  });
  const expected = 'Invalid number of days specified in configuration for nonCompleteExecutionPayloadTimeout: notaninteger';
  t.is(actual, expected);
});
