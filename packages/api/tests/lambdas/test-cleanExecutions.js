'use strict';

const sinon = require('sinon');
const test = require('ava');

const { cleanExecutionPayloads } = require('../../lambdas/cleanExecutions');

const removeRecordsStub = sinon.spy();

class executionModel {
  removeOldPayloadRecords(value) {
    return removeRecordsStub(value);
  }
}

test.serial('Function is called with passed in number of days', async (t) => {
  process.env.executionPayloadRetentionPeriod = 100;
  await cleanExecutionPayloads(executionModel);
  t.truthy(removeRecordsStub.calledWith(100));
});

test.serial('Function returns empty set if passed in value is disabled', async (t) => {
  process.env.executionPayloadRetentionPeriod = 'disabled';
  const actual = await cleanExecutionPayloads(executionModel);
  const expected = [];
  t.deepEqual(actual, expected);
});

test.serial('Function throws error if passed invalid RetentionPeriod', async (t) => {
  process.env.executionPayloadRetentionPeriod = 'testValue';
  let actual;
  await cleanExecutionPayloads(executionModel).catch((e) => {
    actual = e.message;
  });
  const expected = 'Invalid number of days specified in configuration for payload_timout: testValue';
  t.is(actual, expected);
});
