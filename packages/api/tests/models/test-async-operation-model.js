'use strict';

const test = require('ava');
const {
  aws: { dynamodb },
  testUtils: { randomString }
} = require('@cumulus/common');
const { AsyncOperation } = require('../../models');

let asyncOperationModel;
test.before(async () => {
  asyncOperationModel = new AsyncOperation({ tableName: randomString() });
  await asyncOperationModel.createTable();
});

test.after.always(() => asyncOperationModel.deleteTable());

test.serial('The AsyncOperation create() method generates a UUID for the id field', async (t) => {
  const asyncOperation = await asyncOperationModel.create({});

  t.truthy(asyncOperation.id.match(/^[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}/));
});

test.serial('The AsyncOperation create() method writes the record to DynamoDB', async (t) => {
  const asyncOperation = await asyncOperationModel.create({});

  const getItemResponse = await dynamodb().getItem({
    TableName: asyncOperationModel.tableName,
    Key: {
      id: {
        S: asyncOperation.id
      }
    }
  }).promise();

  t.notDeepEqual(getItemResponse, {}); // Returned if the item was not found
  t.is(getItemResponse.Item.id.S, asyncOperation.id);
});

test.serial('The AsyncOperation create() method sets an initial status to "CREATED"', async (t) => {
  const { id: asyncOperationId } = await asyncOperationModel.create({});

  const { status } = await asyncOperationModel.get(asyncOperationId);

  t.is(status, 'CREATED');
});

test.serial('The AsyncOperation get() method returns the correct async operation', async (t) => {
  const { id: asyncOperationId } = await asyncOperationModel.create({});

  const asyncOperation = await asyncOperationModel.get(asyncOperationId);

  t.is(asyncOperation.id, asyncOperationId);
});

test.serial('The AsyncOperation wrapTask() method updates the item in the DB when the task succeeds', async (t) => {
  const { id: asyncOperationId } = await asyncOperationModel.create({});

  await asyncOperationModel.wrapTask(asyncOperationId, () => ({ a: 1, b: 2 }));

  const { status, result } = await asyncOperationModel.get(asyncOperationId);

  t.is(status, 'SUCCEEDED');
  t.deepEqual(result, { a: 1, b: 2 });
});

test.serial('The AsyncOperation wrapTask() method updates the item in the DB when the task fails', async (t) => {
  const { id: asyncOperationId } = await asyncOperationModel.create({});

  await asyncOperationModel.wrapTask(asyncOperationId, () => {
    throw new Error('Complete failure');
  });

  const { status, errorMessage } = await asyncOperationModel.get(asyncOperationId);

  t.is(status, 'FAILED');
  t.is(errorMessage, 'Complete failure');
});
