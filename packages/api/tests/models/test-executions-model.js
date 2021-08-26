'use strict';

const test = require('ava');
const pick = require('lodash/pick');
const { randomId, randomString } = require('@cumulus/common/test-utils');

const { fakeExecutionFactoryV2 } = require('../../lib/testUtils');
const Execution = require('../../models/executions');

test.before(async (t) => {
  process.env.ExecutionsTable = randomString();
  t.context.executionModel = new Execution();
  await t.context.executionModel.createTable();
  t.context.executionName = randomId('execution');

  t.context.workflowStartTime = Date.now();
  t.context.cumulusMessage = {
    cumulus_meta: {
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
      execution_name: t.context.executionName,
      workflow_start_time: t.context.workflowStartTime,
      cumulus_version: '1.2.3',
    },
    meta: {
      status: 'running',
      collection: {
        name: 'my-name',
        version: 'my-version',
      },
    },
    payload: {
      value: 'my-payload',
    },
  };

  t.context.executionArn = `arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:${t.context.executionName}`;
});

test.after.always(async (t) => {
  await t.context.executionModel.deleteTable();
});

test.serial('_getMutableFieldNames() returns correct fields for running status', (t) => {
  const { executionModel } = t.context;

  const updatedItem = {
    arn: randomString(),
    status: 'running',
  };

  const updateFields = executionModel._getMutableFieldNames(updatedItem);

  // Fields are included even if not present in the item.
  t.deepEqual(updateFields, [
    'updatedAt', 'timestamp', 'originalPayload',
  ]);
});

test.serial('_getMutableFieldNames() returns correct fields for completed status', (t) => {
  const { executionModel } = t.context;

  const item = {
    arn: randomString(),
    status: 'completed',
    name: 'execution-1',
    finalPayload: { foo: 'bar' },
  };

  const updateFields = executionModel._getMutableFieldNames(item);

  t.deepEqual(updateFields, Object.keys(item));
});

test('storeExecutionRecord() can be used to create a new execution', async (t) => {
  const { executionModel } = t.context;
  const execution = fakeExecutionFactoryV2();
  await executionModel.storeExecutionRecord(execution);

  const fetchedItem = await executionModel.get({ arn: execution.arn });
  t.is(fetchedItem.status, execution.status);
});

test('storeExecutionRecord() can be used to update an execution', async (t) => {
  const { executionModel } = t.context;
  const execution = fakeExecutionFactoryV2({
    asyncOperationId: '1',
    status: 'running',
  });

  await executionModel.storeExecutionRecord(execution);

  const checkList = ['asyncOperationId', 'status', 'originalPayload'];
  const fetchedItem = await executionModel.get({ arn: execution.arn });
  t.deepEqual(pick(fetchedItem, checkList), pick(execution, checkList));

  const newPayload = { foo: 'bar' };
  const updatedExecution = {
    ...execution,
    asyncOperationId: '2',
    originalPayload: newPayload,
    status: 'completed',
  };

  await executionModel.storeExecutionRecord(updatedExecution);

  const fetchedUpdatedItem = await executionModel.get({ arn: execution.arn });
  t.deepEqual(pick(fetchedUpdatedItem, checkList), pick(updatedExecution, checkList));
  t.notDeepEqual(pick(fetchedUpdatedItem, checkList), pick(fetchedItem, checkList));
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
    executionModel,
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
    executionModel,
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
