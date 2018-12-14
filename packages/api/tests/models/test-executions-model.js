'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const { Execution } = require('../../models');
const Registry = require('../../lib/Registry');

let arn;
let doc;
let manager;
let name;
let executionModel;

const originalPayload = { payload: 'originalPayload' };

function returnDoc(docArn, status) {
  return {
    name: 'randomname',
    arn: docArn,
    execution: 'testExecution',
    collectionId: 'testCollectionId',
    parentArn: 'parentArn',
    error: { test: 'error' },
    tasks: { taskObject: 'testvalue' },
    type: 'testType',
    status: status,
    createdAt: new Date(),
    timestamp: new Date(),
    updatedAt: new Date(),
    duration: 5,
    originalPayload,
    finalPayload: null
  };
}

test.beforeEach(async (t) => {
  const arn = randomString();
  t.context.table = Registry.knex()(Execution.tableName);
  t.context.execution = returnDoc(arn, 'completed');
  t.context.executionModel = new Execution();
  t.context.executionModel.generateDocFromPayload = (_payload) => t.context.execution;
});

test('Insert creates inserts an execution into the database', async (t) => {
  const arn = t.context.execution.arn;
  const execution = t.context.execution;
  await t.context.table.insert(t.context.executionModel.translateItemToSnakeCase(execution));
  const actual = await t.context.executionModel.get({ arn });
  execution.id = actual.id; // This is created on insert
  t.deepEqual(execution, actual);
});


test('Creating an execution adds a record to the database with matching values', async (t) => {
  const executionModel = t.context.executionModel;
  const execution = t.context.execution;
  t.context.table.insert(t.context.execution);
  const actual = await executionModel.createExecutionFromSns(originalPayload);
  execution.id = actual.id; // This is created on insert

  t.deepEqual(execution, actual);
});

test('Updating an existing record updates the record as expected', async (t) => {
  const finalPayload = { test: 'payloadValue' };
  const arn = t.context.execution.arn;
  const execution = t.context.execution;
  const executionModel = t.context.executionModel;

  await t.context.table.insert(executionModel.translateItemToSnakeCase(execution));
  await executionModel.updateExecutionFromSns({ payload: finalPayload });
  const actual = await executionModel.get({ arn });

  execution.originalPayload = originalPayload;
  execution.duration = actual.duration;
  execution.duration = actual.duration;
  execution.finalPayload = finalPayload;
  execution.id = actual.id;

  delete execution.updatedAt;
  delete actual.updatedAt;


  t.deepEqual(finalPayload, actual.finalPayload);
  t.deepEqual(execution, actual);
});

test('RemoveOldPayloadRecords removes payload attributes from old non-completed records', async (t) => {
  const execution = t.context.execution;
  execution.status = 'failed';
  execution.finalPayload = originalPayload;
  const arn = execution.arn;
  const executionModel = t.context.executionModel;
  await t.context.table.insert(executionModel.translateItemToSnakeCase(execution));
  await t.context.executionModel.removeOldPayloadRecords(100, 0, true, false);
  const updatedRecord = await executionModel.get({ arn });

  t.falsy(updatedRecord.originalPayload);
  t.falsy(updatedRecord.finalPayload);
});

test('RemoveOldPayloadRecords fails to remove payload attributes from non-completed records when disabled', async (t) => {
  const execution = t.context.execution;
  const executionModel = t.context.executionModel;
  execution.status = 'failed';
  execution.finalPayload = originalPayload;
  const arn = execution.arn;
  await t.context.table.insert(executionModel.translateItemToSnakeCase(execution));

  await executionModel.removeOldPayloadRecords(100, 0, true, true);
  const updatedRecord = await executionModel.get({ arn: arn });
  t.truthy(updatedRecord.originalPayload);
  t.truthy(updatedRecord.finalPayload);
});

test('RemoveOldPayloadRecords removes payload attributes from old completed records', async (t) => {
  const execution = t.context.execution;
  const executionModel = t.context.executionModel;
  execution.finalPayload = originalPayload;
  const arn = execution.arn;
  await t.context.table.insert(executionModel.translateItemToSnakeCase(execution));
  await executionModel.removeOldPayloadRecords(0, 100, false, true);
  const updatedRecord = await executionModel.get({ arn: arn });
  t.falsy(updatedRecord.originalPayload);
  t.falsy(updatedRecord.finalPayload);
});

test('RemoveOldPayloadRecords fails to remove payload attributes from old completed records when disabled', async (t) => {
  const execution = t.context.execution;
  const executionModel = t.context.executionModel;
  execution.finalPayload = originalPayload;
  const arn = execution.arn;
  await t.context.table.insert(executionModel.translateItemToSnakeCase(execution));

  await executionModel.removeOldPayloadRecords(0, 100, true, true);
  const updatedRecord = await executionModel.get({ arn: arn });
  t.truthy(updatedRecord.originalPayload);
  t.truthy(updatedRecord.finalPayload);
});


test('RemoveOldPayloadRecords does not remove attributes from new non-completed records', async (t) => {
  const execution = t.context.execution;
  const executionModel = t.context.executionModel;
  const updatePayload = { payload: 'payloadValue' };
  execution.finalPayload = updatePayload;
  execution.status = 'failed';
  const arn = execution.arn;
  await t.context.table.insert(executionModel.translateItemToSnakeCase(execution));

  await executionModel.removeOldPayloadRecords(1, 1, false, false);
  const updatedRecord = await executionModel.get({ arn: arn });
  t.deepEqual(originalPayload, updatedRecord.originalPayload);
  t.deepEqual(updatePayload, updatedRecord.finalPayload);
});

test('RemoveOldPayloadRecords does not remove attributes from new completed records', async (t) => {
  const execution = t.context.execution;
  const executionModel = t.context.executionModel;
  const updatePayload = { payload: 'payloadValue' };
  execution.status = 'failed';
  execution.finalPayload = updatePayload;
  const arn = execution.arn;
  await t.context.table.insert(executionModel.translateItemToSnakeCase(execution));

  await executionModel.removeOldPayloadRecords(1, 1, false, false);
  const updatedRecord = await executionModel.get({ arn: arn });
  t.deepEqual(originalPayload, updatedRecord.originalPayload);
  t.deepEqual(updatePayload, updatedRecord.finalPayload);
});
