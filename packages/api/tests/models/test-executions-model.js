'use strict';

const test = require('ava');
const sinon = require('sinon');
const cloneDeep = require('lodash.clonedeep');

const { randomString } = require('@cumulus/common/test-utils');

const Execution = require('../../models/executions');

const pdrSuccessFixture = require('../data/pdr_success.json');
const pdrFailureFixture = require('../data/pdr_failure.json');

let executionDoc;
let executionModel;
let generateDocStub;

const originalPayload = { op: 'originalPayload' };

function returnDoc(status) {
  return {
    name: randomString(),
    arn: randomString(),
    execution: 'testExecution',
    collectionId: 'testCollectionId',
    parentArn: 'parentArn',
    error: { test: 'error' },
    type: 'testType',
    status,
    createdAt: 123456789,
    timestamp: 123456789,
    updatedAt: 123456789
  };
}

async function setupRecord(executionStatus) {
  executionDoc = returnDoc(executionStatus);
  return executionModel.createExecutionFromSns({ payload: originalPayload });
}

test.before(async () => {
  process.env.ExecutionsTable = randomString();
  executionModel = new Execution();
  await executionModel.createTable();
});

test.after.always(async () => {
  await executionModel.deleteTable();
});

test.beforeEach(async () => {
  generateDocStub = sinon.stub(executionModel, 'generateDocFromPayload').callsFake(
    () => executionDoc
  );

  await setupRecord('running');
});

test.afterEach.always(async () => {
  await executionModel.delete({ arn: executionDoc.arn });
  generateDocStub.restore();
});

test.serial('generateDocFromPayload using payload without cumulus_meta.state_machine throws error', (t) => {
  generateDocStub.restore();
  t.throws(
    () => executionModel.generateDocFromPayload({
      cumulus_meta: {
        execution_name: randomString()
      }
    })
  );
});

test.serial('generateDocFromPayload using payload without cumulus_meta.execution_name throws error', (t) => {
  generateDocStub.restore();
  t.throws(
    () => executionModel.generateDocFromPayload({
      cumulus_meta: {
        state_machine: randomString()
      }
    })
  );
});

test.serial('createExecutionFromSns() creates a successful execution record', async (t) => {
  generateDocStub.restore();

  const newPayload = cloneDeep(pdrSuccessFixture);
  newPayload.cumulus_meta.execution_name = randomString();

  const record = await executionModel.createExecutionFromSns(newPayload);

  t.is(record.status, 'completed');
  t.is(record.type, newPayload.meta.workflow_name);
  t.is(record.createdAt, newPayload.cumulus_meta.workflow_start_time);
});

test.serial('createExecutionFromSns() creates a failed execution record', async (t) => {
  generateDocStub.restore();

  const newPayload = cloneDeep(pdrFailureFixture);
  newPayload.cumulus_meta.execution_name = randomString();

  const record = await executionModel.createExecutionFromSns(newPayload);

  t.is(record.status, 'failed');
  t.is(record.type, newPayload.meta.workflow_name);
  t.is(typeof record.error, 'object');
  t.is(record.createdAt, newPayload.cumulus_meta.workflow_start_time);
});

test.serial('Creating an execution adds a record to the database with matching values', async (t) => {
  const recordExists = await executionModel.exists({ arn: executionDoc.arn });
  const record = await executionModel.get({ arn: executionDoc.arn });

  executionDoc.originalPayload = originalPayload;
  delete executionDoc.updatedAt;
  delete record.updatedAt;
  executionDoc.duration = record.duration;

  t.true(recordExists);
  t.deepEqual(record, executionDoc);
});

test.serial('Updating an existing record updates the record as expected', async (t) => {
  const finalPayload = { test: 'payloadValue' };
  await executionModel.get({ arn: executionDoc.arn });
  await executionModel.updateExecutionFromSns({ payload: finalPayload });
  const record = await executionModel.get({ arn: executionDoc.arn });

  executionDoc.originalPayload = originalPayload;
  executionDoc.duration = record.duration;
  executionDoc.finalPayload = finalPayload;
  delete executionDoc.updatedAt;
  delete record.updatedAt;

  t.deepEqual(finalPayload, record.finalPayload);
  t.deepEqual(executionDoc, record);
});

test.serial('RemoveOldPayloadRecords removes payload attributes from old non-completed records', async (t) => {
  await executionModel.updateExecutionFromSns({ payload: { test: 'payloadValue' } });
  await executionModel.removeOldPayloadRecords(100, 0, true, false);
  const updatedRecord = await executionModel.get({ arn: executionDoc.arn });
  t.falsy(updatedRecord.originalPayload);
  t.falsy(updatedRecord.finalPayload);
});

test.serial('RemoveOldPayloadRecords fails to remove payload attributes from non-completed records when disabled', async (t) => {
  await executionModel.updateExecutionFromSns({ payload: { test: 'payloadValue' } });
  await executionModel.removeOldPayloadRecords(100, 0, true, true);
  const updatedRecord = await executionModel.get({ arn: executionDoc.arn });
  t.truthy(updatedRecord.originalPayload);
  t.truthy(updatedRecord.finalPayload);
});

test.serial('RemoveOldPayloadRecords removes payload attributes from old completed records', async (t) => {
  await executionModel.delete({ arn: executionDoc.arn });
  await setupRecord('completed');

  await executionModel.updateExecutionFromSns({ payload: { test: 'payloadValue' } });
  await executionModel.removeOldPayloadRecords(0, 100, false, true);
  const updatedRecord = await executionModel.get({ arn: executionDoc.arn });
  t.falsy(updatedRecord.originalPayload);
  t.falsy(updatedRecord.finalPayload);
});

test.serial('RemoveOldPayloadRecords fails to remove payload attributes from old completed records when disabled', async (t) => {
  await executionModel.delete({ arn: executionDoc.arn });
  await setupRecord('completed');
  await executionModel.updateExecutionFromSns({ payload: { test: 'payloadValue' } });
  await executionModel.removeOldPayloadRecords(0, 100, true, true);
  const updatedRecord = await executionModel.get({ arn: executionDoc.arn });
  t.truthy(updatedRecord.originalPayload);
  t.truthy(updatedRecord.finalPayload);
});


test.serial('RemoveOldPayloadRecords does not remove attributes from new non-completed records', async (t) => {
  const updatePayload = { test: 'payloadValue' };
  await executionModel.updateExecutionFromSns({ payload: updatePayload });
  await executionModel.removeOldPayloadRecords(1, 1, false, false);
  const updatedRecord = await executionModel.get({ arn: executionDoc.arn });
  t.deepEqual(originalPayload, updatedRecord.originalPayload);
  t.deepEqual(updatePayload, updatedRecord.finalPayload);
});

test.serial('RemoveOldPayloadRecords does not remove attributes from new completed records', async (t) => {
  await executionModel.delete({ arn: executionDoc.arn });
  await setupRecord('completed');
  const updatePayload = { test: 'payloadValue' };
  await executionModel.updateExecutionFromSns({ payload: updatePayload });
  await executionModel.removeOldPayloadRecords(1, 1, false, false);
  const updatedRecord = await executionModel.get({ arn: executionDoc.arn });
  t.deepEqual(originalPayload, updatedRecord.originalPayload);
  t.deepEqual(updatePayload, updatedRecord.finalPayload);
});
