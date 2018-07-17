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

test.after.always(async () => {
  asyncOperationModel.deleteTable();
});

test('The AsyncOperation create() method generates a UUID for the id field', async (t) => {
  const asyncOperation = await asyncOperationModel.create({});

  t.truthy(asyncOperation.id.match(/^[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}/));
});

test('The AsyncOperation create() method writes the record to DynamoDB', async (t) => {
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
