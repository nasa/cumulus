'use strict';

const test = require('ava');
const {
  aws: { dynamodb },
  testUtils: { randomString }
} = require('@cumulus/common');

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
  const tableName = randomString();
  const tableHash = { name: 'id', type: 'S' };

  const manager = new Manager({ tableName, tableHash });

  try {
    await createTable({
      tableName,
      tableHash
    });

    const id = randomString();

    await dynamodb().putItem({
      TableName: tableName,
      Item: {
        id: { S: id }
      }
    }).promise();

    t.true(await manager.exists({ id }));
  } finally {
    await deleteTable(tableName);
  }
});

test('Manager.exists() returns false when a record does not exist', async (t) => {
  const tableName = randomString();
  const tableHash = { name: 'id', type: 'S' };

  const manager = new Manager({ tableName, tableHash });

  try {
    await createTable({
      tableName,
      tableHash
    });

    t.false(await manager.exists({ id: 'does-not-exist' }));
  } finally {
    await deleteTable(tableName);
  }
});
