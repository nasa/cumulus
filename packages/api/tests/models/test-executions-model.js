'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const { Execution } = require('../../models');
const Registry = require('../../lib/Registry');

const originalPayload = { payload: 'originalPayload' };
const finalPayload = { payload: 'finalPayload' };

let arn;
let table;
let execution;
let executionModel;

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

test.beforeEach(async () => {
  arn = randomString();
  table = Registry.knex()(Execution.tableName);
  execution = returnDoc(arn, 'completed');
  executionModel = new Execution();
  executionModel.generateDocFromPayload = (_payload) => execution;
});

test.serial('Insert creates inserts an execution into the database', async (t) => {
  await table.insert(executionModel.translateItemToSnakeCase(execution));
  const actual = await executionModel.get({ arn });
  execution.id = actual.id; // This is created on insert
  t.deepEqual(execution, actual);
});


test.serial('Creating an execution adds a record to the database with matching values', async (t) => {
  table.insert(execution);
  const actual = await executionModel.createExecutionFromSns(originalPayload);
  execution.id = actual.id; // This is created on insert

  t.deepEqual(execution, actual);
});

test.serial('Updating an existing record updates the record as expected', async (t) => {
  await table.insert(executionModel.translateItemToSnakeCase(execution));
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

test.serial('RemoveOldPayloadRecords removes payload attributes from old non-completed records', async (t) => {
  execution.status = 'failed';
  execution.finalPayload = originalPayload;

  await table.insert(executionModel.translateItemToSnakeCase(execution));
  await executionModel.removeOldPayloadRecords(100, 0, true, false);
  const updatedRecord = await executionModel.get({ arn });

  t.falsy(updatedRecord.originalPayload);
  t.falsy(updatedRecord.finalPayload);
});

test.serial('RemoveOldPayloadRecords fails to remove payload attributes from non-completed records when disabled', async (t) => {
  execution.status = 'failed';
  execution.finalPayload = originalPayload;

  await table.insert(executionModel.translateItemToSnakeCase(execution));

  await executionModel.removeOldPayloadRecords(100, 0, true, true);
  const updatedRecord = await executionModel.get({ arn: arn });
  t.truthy(updatedRecord.originalPayload);
  t.truthy(updatedRecord.finalPayload);
});

test.serial('RemoveOldPayloadRecords removes payload attributes from old completed records', async (t) => {
  execution.finalPayload = originalPayload;

  await table.insert(executionModel.translateItemToSnakeCase(execution));
  await executionModel.removeOldPayloadRecords(0, 100, false, true);
  const updatedRecord = await executionModel.get({ arn: arn });
  t.falsy(updatedRecord.originalPayload);
  t.falsy(updatedRecord.finalPayload);
});

test.serial('RemoveOldPayloadRecords fails to remove payload attributes from old completed records when disabled', async (t) => {
  execution.finalPayload = originalPayload;

  await table.insert(executionModel.translateItemToSnakeCase(execution));

  await executionModel.removeOldPayloadRecords(0, 100, true, true);
  const updatedRecord = await executionModel.get({ arn: arn });
  t.truthy(updatedRecord.originalPayload);
  t.truthy(updatedRecord.finalPayload);
});


test.serial('RemoveOldPayloadRecords does not remove attributes from new non-completed records', async (t) => {
  execution.finalPayload = finalPayload;
  execution.status = 'failed';

  await table.insert(executionModel.translateItemToSnakeCase(execution));

  await executionModel.removeOldPayloadRecords(1, 1, false, false);
  const updatedRecord = await executionModel.get({ arn: arn });
  t.deepEqual(originalPayload, updatedRecord.originalPayload);
  t.deepEqual(finalPayload, updatedRecord.finalPayload);
});

test.serial('RemoveOldPayloadRecords does not remove attributes from new completed records', async (t) => {
  execution.status = 'failed';
  execution.finalPayload = finalPayload;

  await table.insert(executionModel.translateItemToSnakeCase(execution));

  await executionModel.removeOldPayloadRecords(1, 1, false, false);
  const updatedRecord = await executionModel.get({ arn: arn });
  t.deepEqual(originalPayload, updatedRecord.originalPayload);
  t.deepEqual(finalPayload, updatedRecord.finalPayload);
});
