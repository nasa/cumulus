'use strict';

const test = require('ava');
const { randomId, randomString } = require('@cumulus/common/test-utils');

const Execution = require('../../models/executions');

test.before(async (t) => {
  process.env.ExecutionsTable = randomString();
  t.context.executionModel = new Execution();
  await t.context.executionModel.createTable();
});

test.beforeEach(async (t) => {
  t.context.executionName = randomId('execution');

  t.context.cumulusMessage = {
    cumulus_meta: {
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
      execution_name: t.context.executionName,
      workflow_start_time: 123,
      workflow_stop_time: null
    },
    meta: {
      status: 'running',
      collection: {
        name: 'my-name',
        version: 'my-version'
      }
    },
    payload: {
      value: 'my-payload'
    }
  };

  t.context.executionArn = `arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:${t.context.executionName}`;
});

test.after.always(async (t) => {
  await t.context.executionModel.deleteTable();
});

test('generateRecord() returns the correct record in the basic case', (t) => {
  const { cumulusMessage, executionArn, executionName } = t.context;

  const actualRecord = Execution.generateRecord(cumulusMessage);

  const expectedRecord = {
    name: executionName,
    arn: executionArn,
    execution: `https://console.aws.amazon.com/states/home?region=us-east-1#/executions/details/${executionArn}`,
    collectionId: 'my-name___my-version',
    error: {},
    status: 'running',
    createdAt: 123,
    timestamp: actualRecord.timestamp,
    updatedAt: actualRecord.updatedAt,
    originalPayload: {
      value: 'my-payload'
    },
    duration: 0
  };

  t.deepEqual(actualRecord, expectedRecord);
});

test('generateRecord() throws an exception if the execution ARN cannot be determined', (t) => {
  t.throws(
    () => Execution.generateRecord({
      cumulus_meta: {}
    })
  );
});

test('generateRecord() throws an exception if meta.status is not present', (t) => {
  const { cumulusMessage } = t.context;

  delete cumulusMessage.meta.status;

  t.throws(() => Execution.generateRecord(cumulusMessage));
});

test('generateRecord() returns a record with asyncOperationId when available', (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.cumulus_meta.asyncOperationId = 'my-asyncOperationId';

  const record = Execution.generateRecord(cumulusMessage);

  t.is(record.asyncOperationId, 'my-asyncOperationId');
});

test('generateRecord() returns a record with parentArn when available', (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.cumulus_meta.parentExecutionArn = 'my-parentArn';

  const record = Execution.generateRecord(cumulusMessage);

  t.is(record.parentArn, 'my-parentArn');
});

test('generateRecord() returns a record with tasks when available', (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.meta.workflow_tasks = 'my-tasks';

  const record = Execution.generateRecord(cumulusMessage);

  t.is(record.tasks, 'my-tasks');
});

test('generateRecord() returns a record with type when available', (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.meta.workflow_name = 'my-workflow-name';

  const record = Execution.generateRecord(cumulusMessage);

  t.is(record.type, 'my-workflow-name');
});

test('generateRecord() returns a record with correct payload for non-running messages', (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload = 'my-payload';

  const record = Execution.generateRecord(cumulusMessage);

  t.is(record.finalPayload, 'my-payload');
  t.is(record.originalPayload, undefined);
});

test('generateRecord() returns a record with correct duration for non-running messages', (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.meta.status = 'completed';

  const startTime = cumulusMessage.cumulus_meta.workflow_start_time;
  cumulusMessage.cumulus_meta.workflow_stop_time = startTime + 1000;

  const record = Execution.generateRecord(cumulusMessage);

  t.is(record.duration, 1);
});

test.serial('_getMutableFieldNames() returns correct fields for running status', async (t) => {
  const { executionModel } = t.context;

  const updatedItem = {
    arn: randomString(),
    status: 'running'
  };

  const updateFields = executionModel._getMutableFieldNames(updatedItem);

  // Fields are included even if not present in the item.
  t.deepEqual(updateFields, [
    'createdAt', 'updatedAt', 'timestamp', 'originalPayload'
  ]);
});

test.serial('_getMutableFieldNames() returns correct fields for completed status', async (t) => {
  const { executionModel } = t.context;

  const item = {
    arn: randomString(),
    status: 'completed',
    name: 'execution-1',
    finalPayload: { foo: 'bar' }
  };

  const updateFields = executionModel._getMutableFieldNames(item);

  t.deepEqual(updateFields, Object.keys(item));
});

test.serial('storeExecutionFromCumulusMessage() can be used to create a new running execution', async (t) => {
  const { executionArn, cumulusMessage, executionModel } = t.context;

  await executionModel.storeExecutionFromCumulusMessage(cumulusMessage);

  const fetchedItem = await executionModel.get({ arn: executionArn });

  t.is(fetchedItem.status, 'running');
});

test.serial('storeExecutionFromCumulusMessage() can be used to update a running execution', async (t) => {
  const {
    cumulusMessage,
    executionArn,
    executionModel
  } = t.context;

  cumulusMessage.cumulus_meta.asyncOperationId = '1';
  await executionModel.storeExecutionFromCumulusMessage(cumulusMessage);

  cumulusMessage.meta.status = 'running';
  const newPayload = { foo: 'bar' };
  cumulusMessage.payload = newPayload;
  cumulusMessage.cumulus_meta.asyncOperationId = '2';
  await executionModel.storeExecutionFromCumulusMessage(cumulusMessage);

  const fetchedItem = await executionModel.get({ arn: executionArn });

  t.is(fetchedItem.status, 'running');
  // should have been updated
  t.deepEqual(fetchedItem.originalPayload, newPayload);
  // should not have been updated
  t.is(fetchedItem.asyncOperationId, '1');
});

test.serial('storeExecutionFromCumulusMessage() can be used to create a new completed execution', async (t) => {
  const { executionArn, executionModel, cumulusMessage } = t.context;

  cumulusMessage.meta.status = 'completed';
  await executionModel.storeExecutionFromCumulusMessage(cumulusMessage);

  const fetchedItem = await executionModel.get({ arn: executionArn });

  t.is(fetchedItem.status, 'completed');
});

test.serial('storeExecutionFromCumulusMessage() can be used to update a completed execution', async (t) => {
  const {
    cumulusMessage,
    executionArn,
    executionModel
  } = t.context;

  await executionModel.storeExecutionFromCumulusMessage(cumulusMessage);

  const newFinalPayload = { foo2: 'bar' };
  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload = newFinalPayload;

  await executionModel.storeExecutionFromCumulusMessage(cumulusMessage);

  const fetchedItem = await executionModel.get({ arn: executionArn });

  t.is(fetchedItem.status, 'completed');
  t.deepEqual(fetchedItem.finalPayload, newFinalPayload);
});

test.serial('storeExecutionFromCumulusMessage() will not allow a running status to replace a completed status', async (t) => {
  const { executionArn, cumulusMessage, executionModel } = t.context;

  cumulusMessage.meta.status = 'completed';
  await executionModel.storeExecutionFromCumulusMessage(cumulusMessage);

  cumulusMessage.meta.status = 'running';
  await executionModel.storeExecutionFromCumulusMessage(cumulusMessage);

  const fetchedItem = await executionModel.get({ arn: executionArn });

  t.is(fetchedItem.status, 'completed');
});
