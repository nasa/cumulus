'use strict';

const test = require('ava');
const { dynamodb } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');

const Manager = require('../../models/base');

async function createTable({ tableName, tableHash }) {
  const params = {
    TableName: tableName,
    AttributeDefinitions: [{
      AttributeName: tableHash.name,
      AttributeType: tableHash.type
    }],
    KeySchema: [{
      AttributeName: tableHash.name,
      KeyType: 'HASH'
    }],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  await dynamodb().createTable(params).promise();
  return dynamodb().waitFor('tableExists', { TableName: tableName }).promise();
}

const deleteTable = (TableName) =>
  dynamodb().deleteTable({ TableName }).promise()
    .then(() => dynamodb().waitFor('tableNotExists', { TableName }).promise());

test.beforeEach(async (t) => {
  t.context.tableName = randomString();

  const tableHash = { name: 'id', type: 'S' };
  t.context.manager = new Manager({
    tableName: t.context.tableName,
    tableHash
  });

  await createTable({
    tableName: t.context.tableName,
    tableHash
  });
});

test.afterEach.always(async (t) => {
  await deleteTable(t.context.tableName);
});

test('The Manager constructor throws an exception if the tableName property is not set', (t) => {
  t.throws(
    () => (new Manager({ tableHash: {} })),
    TypeError
  );
});

test('The Manager constructor throws an exception if the tableHash property is not set', (t) => {
  t.throws(
    () => (new Manager({ tableName: 'asdf' })),
    TypeError
  );
});

test('Manager.createTable() creates the correct table', async (t) => {
  const tableName = randomString();
  const manager = new Manager({
    tableName,
    tableHash: { name: 'id', type: 'S' }
  });

  try {
    await manager.createTable();
    const describeTableResponse = await dynamodb().describeTable({
      TableName: tableName
    }).promise();

    t.is(describeTableResponse.Table.TableStatus, 'ACTIVE');
  } finally {
    await deleteTable(tableName);
  }
});

test('The Manager deleteTable method deletes the correct table', async (t) => {
  const tableName = randomString();
  const manager = new Manager({
    tableName,
    tableHash: { name: 'id', type: 'S' }
  });

  await manager.createTable();
  const describeTableResponse = await dynamodb().describeTable({
    TableName: tableName
  }).promise();

  t.is(describeTableResponse.Table.TableStatus, 'ACTIVE');

  await manager.deleteTable();

  try {
    await dynamodb().describeTable({ TableName: tableName }).promise();
    t.fail();
  } catch (err) {
    t.is(err.code, 'ResourceNotFoundException');
  }
});

test('Manager.exists() returns true when a record exists', async (t) => {
  const { tableName, manager } = t.context;

  const id = randomString();

  await dynamodb().putItem({
    TableName: tableName,
    Item: {
      id: { S: id }
    }
  }).promise();

  t.true(await manager.exists({ id }));
});

test('Manager.exists() returns false when a record does not exist', async (t) => {
  const { manager } = t.context;

  t.false(await manager.exists({ id: 'does-not-exist' }));
});

test('Manager.buildDocClientUpdateParams() returns null for an empty item', (t) => {
  const { manager } = t.context;
  t.is(manager.buildDocClientUpdateParams({
    item: {},
    itemKey: null
  }), null);
});

test('Manager.buildDocClientUpdateParams() does not try to update the key fields', (t) => {
  const { manager } = t.context;

  const item = {
    id: 'value1',
    key: 'value2',
    foo: 'bar'
  };

  const actualParams = manager.buildDocClientUpdateParams({
    item,
    itemKeyFields: ['id', 'key'],
    itemKey: { id: item.id, key: item.key }
  });

  t.false(Object.keys(actualParams.ExpressionAttributeNames).includes('#key1'));
  t.false(Object.keys(actualParams.ExpressionAttributeValues).includes(':key1'));
  t.false(actualParams.UpdateExpression.includes('key1'));

  t.false(Object.keys(actualParams.ExpressionAttributeNames).includes('#key2'));
  t.false(Object.keys(actualParams.ExpressionAttributeValues).includes(':key2'));
  t.false(actualParams.UpdateExpression.includes('key2'));
});

test('buildDocClientUpdateParams() does not try to update a value to `undefined`', (t) => {
  const { manager } = t.context;

  const itemKey = { id: 'value' };
  const item = {
    ...itemKey,
    foo: 'bar',
    wrong: undefined
  };

  const actualParams = manager.buildDocClientUpdateParams({
    item,
    itemKeyFields: ['id'],
    itemKey,
    alwaysUpdateFields: ['foo']
  });

  t.false(Object.keys(actualParams.ExpressionAttributeNames).includes('#wrong'));
  t.false(Object.keys(actualParams.ExpressionAttributeValues).includes(':wrong'));
  t.false(actualParams.UpdateExpression.includes('wrong'));
});
