'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const { Manager, Execution } = require('../../models');

let arn;
let doc;
let manager;
let name;
let executionModel;

const originalPayload = { op: 'originalPayload' };

function returnDoc(docArn) {
  return {
    name: name,
    arn: docArn,
    execution: 'testExecution',
    collectionId: 'testCollectionId',
    parentArn: 'parentArn',
    error: { test: 'error' },
    type: 'testType',
    status: 'running',
    createdAt: 123456789,
    timestamp: 123456789,
    updatedAt: 123456789
  };
}

test.before(async () => {
  process.env.ExecutionsTable = randomString();
  manager = new Manager({
    tableName: process.env.ExecutionsTable,
    tableHash: { name: 'arn', type: 'S' }
  });
  await manager.createTable();
});

test.after.always(async () => {
  await manager.deleteTable();
});

test.beforeEach(async () => {
  arn = randomString();
  name = randomString();
  executionModel = new Execution();
  doc = returnDoc(arn);
  executionModel.generateDocFromPayload = (_payload) => returnDoc(arn);
  await executionModel.createExecutionFromSns({ payload: originalPayload });
});

test.afterEach(async () => {
  await executionModel.delete({ arn: arn });
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

test.serial('Updating an existing record updates the record ', async (t) => {
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

test.serial('RemoveOldPayloadRecords removes payload attributes from old records', async (t) => {
  await executionModel.updateExecutionFromSns({ payload: { test: 'payloadValue' } });
  await executionModel.removeOldPayloadRecords(0);
  const updatedRecord = await executionModel.get({ arn: arn });
  t.falsy(updatedRecord.originalPayload);
  t.falsy(updatedRecord.finalPayload);
});

test.serial('RemoveOldPayloadRecords does not remove attributes from new records', async (t) => {
  const updatePayload = { test: 'payloadValue' };
  await executionModel.updateExecutionFromSns({ payload: updatePayload });
  await executionModel.removeOldPayloadRecords(1);
  const updatedRecord = await executionModel.get({ arn: arn });
  t.deepEqual(originalPayload, updatedRecord.originalPayload);
  t.deepEqual(updatePayload, updatedRecord.finalPayload);
});
