'use strict';

const test = require('ava');
const cloneDeep = require('lodash.clonedeep');

const { constructCollectionId } = require('@cumulus/common/collection-config-store');
const { RecordDoesNotExist } = require('@cumulus/common/errors');
const { randomString } = require('@cumulus/common/test-utils');

const Execution = require('../../models/executions');

const pdrSuccessFixture = require('../data/pdr_success.json');
const pdrFailureFixture = require('../data/pdr_failure.json');

let executionModel;

const originalPayload = { op: 'originalPayload' };
const stateMachineArn = 'arn:aws:states:us-east-1:123456789012:stateMachine:HelloStateMachine';
const executionArnBase = 'arn:aws:states:us-east-1:123456789012:execution:HelloStateMachine';

const getExecutionArn = (executionName) => `${executionArnBase}:${executionName}`;
const getExecutionUrl = (arn) => `https://console.aws.amazon.com/states/home?region=us-east-1#/executions/details/${arn}`;

const createExecutionMessage = ({
  executionName,
  status = 'running'
}) => ({
  cumulus_meta: {
    execution_name: executionName,
    state_machine: stateMachineArn,
    workflow_start_time: Date.now()
  },
  meta: {
    collection: {
      name: randomString(),
      version: randomString()
    },
    provider: {
      host: randomString(),
      protocol: 's3'
    },
    workflow_name: 'test',
    status,
    workflow_tasks: {
      task1: {
        arn: randomString(),
        name: randomString(),
        version: 1
      }
    }
  }
});

test.before(async () => {
  process.env.ExecutionsTable = randomString();
  executionModel = new Execution();
  await executionModel.createTable();
});

test.after.always(async () => {
  await executionModel.deleteTable();
});

test.beforeEach(async (t) => {
  t.context.executionName = randomString();
  t.context.arn = getExecutionArn(t.context.executionName);
  t.context.executionUrl = getExecutionUrl(t.context.arn);
});

test.afterEach.always(async (t) => {
  await executionModel.delete({ arn: t.context.arn });
});

test.serial('generateRecord() using payload without cumulus_meta.state_machine throws error', async (t) => {
  await t.throwsAsync(
    () => Execution.generateRecord({
      cumulus_meta: {
        execution_name: randomString()
      }
    })
  );
});

test.serial('generateRecord() using payload without cumulus_meta.execution_name throws error', async (t) => {
  await t.throwsAsync(
    () => Execution.generateRecord({
      cumulus_meta: {
        state_machine: randomString()
      }
    })
  );
});

test('generateRecord() generates the correct record for a running execution', async (t) => {
  const { arn, executionName, executionUrl } = t.context;
  const message = createExecutionMessage({
    executionName
  });
  message.payload = { foo: 'bar' };

  const record = await Execution.generateRecord(message);

  const { collection } = message.meta;

  t.is(record.name, executionName);
  t.is(record.arn, arn);
  t.is(record.status, 'running');
  t.is(record.execution, executionUrl);
  t.is(record.type, message.meta.workflow_name);
  t.is(record.createdAt, message.cumulus_meta.workflow_start_time);
  t.is(record.collectionId, constructCollectionId(collection.name, collection.version));
  // Seems like this is wrong. If message.exception is undefined, then record.error
  // should be undefined or an empty object?
  t.deepEqual(record.error, { Error: 'Unknown Error', Cause: undefined });
  t.deepEqual(record.tasks, message.meta.workflow_tasks);
  t.deepEqual(record.originalPayload, message.payload);
  t.is(typeof record.timestamp, 'number');
  t.is(typeof record.duration, 'number');
});

test('generateRecord() correctly updates an execution record', async (t) => {
  const { arn, executionName, executionUrl } = t.context;

  const message = createExecutionMessage({
    executionName
  });

  message.payload = originalPayload;
  const originalRecord = await Execution.generateRecord(message);

  await executionModel.create(originalRecord);

  const { collection } = message.meta;

  message.meta.status = 'failed';
  message.exception = {
    Error: 'Test error',
    Cause: 'Error cause'
  };
  const finalPayload = { foo: 'bar' };
  message.payload = finalPayload;
  const updatedRecord = await Execution.generateRecord(message, true);

  t.is(updatedRecord.name, executionName);
  t.is(updatedRecord.arn, arn);
  t.is(updatedRecord.status, 'failed');
  t.is(updatedRecord.execution, executionUrl);
  t.is(updatedRecord.type, message.meta.workflow_name);
  t.is(updatedRecord.createdAt, message.cumulus_meta.workflow_start_time);
  t.is(updatedRecord.collectionId, constructCollectionId(collection.name, collection.version));
  t.is(typeof updatedRecord.error, 'object');
  t.is(updatedRecord.createdAt, message.cumulus_meta.workflow_start_time);
  t.is(typeof updatedRecord.timestamp, 'number');
  t.is(typeof updatedRecord.duration, 'number');
  t.deepEqual(updatedRecord.originalPayload, originalPayload);
  t.deepEqual(updatedRecord.finalPayload, finalPayload);
});

test('generateRecord() throws error when trying to update a non-existent record', async (t) => {
  const { executionName } = t.context;

  const message = createExecutionMessage({
    executionName,
    status: 'completed'
  });

  await t.throwsAsync(
    () => Execution.generateRecord(message),
    { instanceOf: RecordDoesNotExist }
  );
});

test('updateExecutionFromSns() updates a successful execution record', async (t) => {
  const newPayload = cloneDeep(pdrSuccessFixture);

  const originalStatus = newPayload.meta.status;
  newPayload.meta.status = 'running';

  await executionModel.createExecutionFromSns(newPayload);

  newPayload.meta.status = originalStatus;

  const record = await executionModel.updateExecutionFromSns(newPayload);

  t.is(record.status, 'completed');
  t.is(record.type, newPayload.meta.workflow_name);
  t.is(record.createdAt, newPayload.cumulus_meta.workflow_start_time);
});

test('updateExecutionFromSns() updates a failed execution record', async (t) => {
  const newPayload = cloneDeep(pdrFailureFixture);

  const originalStatus = newPayload.meta.status;
  newPayload.meta.status = 'running';

  await executionModel.createExecutionFromSns(newPayload);

  newPayload.meta.status = originalStatus;

  const record = await executionModel.updateExecutionFromSns(newPayload);

  t.is(record.status, 'failed');
  t.is(record.type, newPayload.meta.workflow_name);
  t.is(typeof record.error, 'object');
  t.is(record.createdAt, newPayload.cumulus_meta.workflow_start_time);
});

test('Creating an execution adds a record to the database with matching values', async (t) => {
  const { arn, executionName } = t.context;

  const message = createExecutionMessage({ executionName });
  message.payload = originalPayload;

  await executionModel.createExecutionFromSns(message);
  const record = await executionModel.get({ arn });

  const expectedRecord = {
    ...record,
    originalPayload
  };
  t.deepEqual(record, expectedRecord);
});

test('Updating an existing record updates the record as expected', async (t) => {
  const { arn, executionName } = t.context;

  const message = createExecutionMessage({ executionName });

  await executionModel.createExecutionFromSns(message);
  const originalRecord = await executionModel.get({ arn });

  const finalPayload = { test: 'payloadValue' };
  message.meta.status = 'completed';
  message.payload = finalPayload;

  await executionModel.updateExecutionFromSns(message);

  const record = await executionModel.get({ arn });

  const expectedRecord = {
    ...originalRecord,
    finalPayload,
    status: 'completed',
    type: 'test',
    duration: record.duration,
    timestamp: record.timestamp,
    updatedAt: record.updatedAt
  };

  t.deepEqual(record, expectedRecord);
});

test.serial('RemoveOldPayloadRecords removes payload attributes from old non-completed records', async (t) => {
  const { arn, executionName } = t.context;
  const message = createExecutionMessage({ executionName });

  await executionModel.createExecutionFromSns(message);
  message.payload = { test: 'payloadValue' };
  await executionModel.updateExecutionFromSns(message);
  await executionModel.removeOldPayloadRecords(100, 0, true, false);

  const updatedRecord = await executionModel.get({ arn });
  t.falsy(updatedRecord.originalPayload);
});

test.serial('RemoveOldPayloadRecords fails to remove payload attributes from non-completed records when disabled', async (t) => {
  const { arn, executionName } = t.context;
  const message = createExecutionMessage({ executionName });

  message.payload = { test: 'value1' };
  await executionModel.createExecutionFromSns(message);
  message.payload = { test: 'value2' };
  await executionModel.updateExecutionFromSns(message);
  await executionModel.removeOldPayloadRecords(100, 0, true, true);

  const updatedRecord = await executionModel.get({ arn });
  t.truthy(updatedRecord.originalPayload);
});

test.serial('RemoveOldPayloadRecords removes payload attributes from old completed records', async (t) => {
  const { arn, executionName } = t.context;

  const message = createExecutionMessage({ executionName });

  message.payload = { test: 'value1' };
  await executionModel.createExecutionFromSns(message);
  message.payload = { test: 'value2' };
  message.meta.status = 'completed';
  await executionModel.updateExecutionFromSns(message);
  await executionModel.removeOldPayloadRecords(0, 100, false, true);

  const updatedRecord = await executionModel.get({ arn });
  t.falsy(updatedRecord.originalPayload);
  t.falsy(updatedRecord.finalPayload);
});

test.serial('RemoveOldPayloadRecords fails to remove payload attributes from old completed records when disabled', async (t) => {
  const { arn, executionName } = t.context;

  const message = createExecutionMessage({ executionName });

  message.payload = { test: 'value1' };
  await executionModel.createExecutionFromSns(message);
  message.payload = { test: 'value2' };
  message.meta.status = 'completed';
  await executionModel.updateExecutionFromSns(message);
  await executionModel.removeOldPayloadRecords(0, 100, true, true);

  const updatedRecord = await executionModel.get({ arn });
  t.truthy(updatedRecord.originalPayload);
  t.truthy(updatedRecord.finalPayload);
});

test.serial('RemoveOldPayloadRecords does not remove attributes from new non-completed records', async (t) => {
  const { arn, executionName } = t.context;
  const message = createExecutionMessage({ executionName });

  const payload = { test: 'payloadValue' };
  message.payload = payload;
  await executionModel.createExecutionFromSns(message);
  await executionModel.removeOldPayloadRecords(1, 1, false, false);

  const updatedRecord = await executionModel.get({ arn });
  t.deepEqual(updatedRecord.originalPayload, payload);
});

test.serial('RemoveOldPayloadRecords does not remove attributes from new completed records', async (t) => {
  const { arn, executionName } = t.context;

  const message = createExecutionMessage({ executionName });

  message.payload = originalPayload;
  await executionModel.createExecutionFromSns(message);
  const updatePayload = { test: 'payloadValue' };
  message.payload = updatePayload;
  message.meta.status = 'completed';
  await executionModel.updateExecutionFromSns(message);
  await executionModel.removeOldPayloadRecords(0, 100, true, true);
  await executionModel.removeOldPayloadRecords(1, 1, false, false);

  const updatedRecord = await executionModel.get({ arn });
  t.deepEqual(originalPayload, updatedRecord.originalPayload);
  t.deepEqual(updatePayload, updatedRecord.finalPayload);
});
