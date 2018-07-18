'use strict';

const test = require('ava');
const {
  aws: { dynamodb },
  testUtils: { randomString }
} = require('@cumulus/common');

const Manager = require('../../models/base');

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

test.serial('The Manager createTable method creates the correct table', async (t) => {
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
  }
  finally {
    await manager.deleteTable();
  }
});

test.serial('The Manager deleteTable method deletes the correct table', async (t) => {
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
  }
  catch (err) {
    t.is(err.code, 'ResourceNotFoundException');
  }
});
