'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');

const { fakeExecutionFactoryV2 } = require('../../lib/testUtils');
const Execution = require('../../models/executions');

test.before(async (t) => {
  process.env.ExecutionsTable = randomString();
  t.context.executionModel = new Execution();
  await t.context.executionModel.createTable();
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

test.serial('storeExecution() can be used to create a new running execution', async (t) => {
  const { executionModel } = t.context;
  const executionItem = fakeExecutionFactoryV2({
    status: 'running',
  });

  await executionModel.storeExecution(executionItem);

  const fetchedItem = await executionModel.get({ arn: executionItem.arn });

  t.is(fetchedItem.status, 'running');
});

test.serial('storeExecution() can be used to update a running execution', async (t) => {
  const {
    executionModel,
  } = t.context;

  const executionItem = fakeExecutionFactoryV2({
    status: 'running',
    originalPayload: {
      key: 'value',
    },
    asyncOperationId: '1',
  });

  await executionModel.storeExecution(executionItem);

  const newPayload = { foo: 'bar' };
  const updatedItem = {
    ...executionItem,
    originalPayload: newPayload,
    asyncOperationId: '2',
  };
  await executionModel.storeExecution(updatedItem);

  const fetchedItem = await executionModel.get({ arn: executionItem.arn });

  t.is(fetchedItem.status, 'running');
  // should have been updated
  t.deepEqual(fetchedItem.originalPayload, newPayload);
  // should not have been updated
  t.is(fetchedItem.asyncOperationId, '1');
});

test.serial('storeExecution() can be used to create a new completed execution', async (t) => {
  const { executionModel } = t.context;

  const executionItem = fakeExecutionFactoryV2({
    status: 'completed',
  });
  await executionModel.storeExecution(executionItem);

  const fetchedItem = await executionModel.get({ arn: executionItem.arn });

  t.is(fetchedItem.status, 'completed');
});

test.serial('storeExecution() can be used to update a completed execution', async (t) => {
  const {
    executionModel,
  } = t.context;

  const executionItem = fakeExecutionFactoryV2({
    status: 'completed',
    finalPayload: {
      foo: 'bar',
    },
  });

  await executionModel.storeExecution(executionItem);

  const newFinalPayload = { foo2: 'bar' };
  const updatedItem = {
    ...executionItem,
    finalPayload: newFinalPayload,
  };

  await executionModel.storeExecution(updatedItem);

  const fetchedItem = await executionModel.get({ arn: executionItem.arn });
  t.is(fetchedItem.status, 'completed');
  t.deepEqual(fetchedItem.finalPayload, newFinalPayload);
});

test.serial('storeExecution() will not allow a running status to replace a completed status', async (t) => {
  const { executionModel } = t.context;

  const executionItem = fakeExecutionFactoryV2({
    status: 'completed',
  });
  await executionModel.storeExecution(executionItem);

  const updatedItem = {
    ...executionItem,
    status: 'running',
  };
  await executionModel.storeExecution(updatedItem);

  const fetchedItem = await executionModel.get({ arn: executionItem.arn });

  t.is(fetchedItem.status, 'completed');
});
