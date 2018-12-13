'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const { Execution } = require('../../models');
const { fakeExecutionFactory } = require('../../lib/testutils');
const Registry = require('../../lib/Registry');

let arn;
let doc;
let manager;
let name;
let executionModel;

const originalPayload = { op: 'originalPayload' };

function returnDoc(docArn, status) {
  return {
    name: name,
    arn: docArn,
    execution: 'testExecution',
    collectionId: 'testCollectionId',
    parentArn: 'parentArn',
    error: { test: 'error' },
    type: 'testType',
    status: status,
    createdAt: 123456789,
    timestamp: 123456789,
    updatedAt: 123456789
  };
}

/**
 * creates fake execution records
 *
 * @param {string} status - pdr status (default to completed)
 * @param {string} type - workflow type (default to fakeWorkflow)
 * @returns {Object} fake execution object
 */
function fakeDbExecutionFactory(status = 'completed', type = 'fakeWorkflow') {



async function setupRecord(executionStatus) {
  arn = randomString();
  name = randomString();
  executionModel = new Execution();
  doc = returnDoc(arn, executionStatus);
  executionModel.generateDocFromPayload = (_payload) => returnDoc(arn, executionStatus);
  await executionModel.createExecutionFromSns({ payload: originalPayload });
}

test.before(async () => {
});

test.after.always(async () => {
});

test.beforeEach(async (t) => {
  t.context.table = Registry.knex()(Execution.tableName);
  t.context.provider = fakeExecutionFactory();
});

test.afterEach(async () => {
});

test.serial('Creating an execution adds a record to the database with matching values', async (t) => {
  const recordExists = await executionModel.exists({ arn: arn });
  const record = await executionModel.get({ arn: arn });

  doc.originalPayload = originalPayload;
  delete doc.updatedAt;
  delete record.updatedAt;
  doc.duration = record.duration;

  t.true(recordExists);
  t.deepEqual(record, doc);
});

test.serial('Updating an existing record updates the record as expected', async (t) => {
  const finalPayload = { test: 'payloadValue' };
  await executionModel.get({ arn: arn });
  await executionModel.updateExecutionFromSns({ payload: finalPayload });
  const record = await executionModel.get({ arn: arn });

  doc.originalPayload = originalPayload;
  doc.duration = record.duration;
  doc.finalPayload = finalPayload;
  delete doc.updatedAt;
  delete record.updatedAt;

  t.deepEqual(finalPayload, record.finalPayload);
  t.deepEqual(doc, record);
});

test.serial('RemoveOldPayloadRecords removes payload attributes from old non-completed records', async (t) => {
  await executionModel.updateExecutionFromSns({ payload: { test: 'payloadValue' } });
  await executionModel.removeOldPayloadRecords(100, 0, true, false);
  const updatedRecord = await executionModel.get({ arn: arn });
  t.falsy(updatedRecord.originalPayload);
  t.falsy(updatedRecord.finalPayload);
});

test.serial('RemoveOldPayloadRecords fails to remove payload attributes from non-completed records when disabled', async (t) => {
  await executionModel.updateExecutionFromSns({ payload: { test: 'payloadValue' } });
  await executionModel.removeOldPayloadRecords(100, 0, true, true);
  const updatedRecord = await executionModel.get({ arn: arn });
  t.truthy(updatedRecord.originalPayload);
  t.truthy(updatedRecord.finalPayload);
});

test.serial('RemoveOldPayloadRecords removes payload attributes from old completed records', async (t) => {
  await executionModel.delete({ arn: arn });
  await setupRecord('completed');

  await executionModel.updateExecutionFromSns({ payload: { test: 'payloadValue' } });
  await executionModel.removeOldPayloadRecords(0, 100, false, true);
  const updatedRecord = await executionModel.get({ arn: arn });
  t.falsy(updatedRecord.originalPayload);
  t.falsy(updatedRecord.finalPayload);
});

test.serial('RemoveOldPayloadRecords fails to remove payload attributes from old completed records when disabled', async (t) => {
  await executionModel.delete({ arn: arn });
  await setupRecord('completed');
  await executionModel.updateExecutionFromSns({ payload: { test: 'payloadValue' } });
  await executionModel.removeOldPayloadRecords(0, 100, true, true);
  const updatedRecord = await executionModel.get({ arn: arn });
  t.truthy(updatedRecord.originalPayload);
  t.truthy(updatedRecord.finalPayload);
});


test.serial('RemoveOldPayloadRecords does not remove attributes from new non-completed records', async (t) => {
  const updatePayload = { test: 'payloadValue' };
  await executionModel.updateExecutionFromSns({ payload: updatePayload });
  await executionModel.removeOldPayloadRecords(1, 1, false, false);
  const updatedRecord = await executionModel.get({ arn: arn });
  t.deepEqual(originalPayload, updatedRecord.originalPayload);
  t.deepEqual(updatePayload, updatedRecord.finalPayload);
});

test.serial('RemoveOldPayloadRecords does not remove attributes from new completed records', async (t) => {
  await executionModel.delete({ arn: arn });
  await setupRecord('completed');
  const updatePayload = { test: 'payloadValue' };
  await executionModel.updateExecutionFromSns({ payload: updatePayload });
  await executionModel.removeOldPayloadRecords(1, 1, false, false);
  const updatedRecord = await executionModel.get({ arn: arn });
  t.deepEqual(originalPayload, updatedRecord.originalPayload);
  t.deepEqual(updatePayload, updatedRecord.finalPayload);
});
