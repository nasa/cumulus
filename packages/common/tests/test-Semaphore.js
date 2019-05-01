'use strict';

const test = require('ava');
const { dynamodb, dynamodbDocClient } = require('../aws');
const Semaphore = require('../Semaphore');
const { randomId } = require('../test-utils');

test.before(async () => {
  process.env.SemaphoresTable = randomId('SemaphoresTable');

  await dynamodb().createTable({
    TableName: process.env.SemaphoresTable,
    AttributeDefinitions: [
      { AttributeName: 'key', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'key', KeyType: 'HASH' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  }).promise();
});

test.beforeEach(async (t) => {
  t.context.semaphore = new Semaphore(
    dynamodbDocClient(),
    process.env.SemaphoresTable
  );
  t.context.key = randomId('key');
});

test.after.always(async () => {
  await dynamodb().deleteTable({ TableName: process.env.SemaphoresTable }).promise();
});

test('Semaphore.add() can increase the semaphore value up to the maximum', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 2;

  try {
    await Promise.all([
      semaphore.add(key, 1, maximum),
      semaphore.add(key, 1, maximum)
    ]);
  } catch (err) {
    console.log(err);
    t.fail();
  }

  t.pass();
});

test('Semaphore.add() cannot increment the semaphore value beyond the maximum', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 1;

  try {
    await Promise.all([
      semaphore.add(key, 1, maximum),
      semaphore.add(key, 1, maximum)
    ]);
    t.fail('expected error to be thrown');
  } catch (err) {
    t.pass();
  }
});

test('Semaphore.add() cannot increment the semaphore value when maximum is 0', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 0;

  try {
    await semaphore.add(key, 1, maximum);
    t.fail('expected error to be thrown');
  } catch (err) {
    t.pass();
  }
});

test('Semaphore.up() increments the semaphore value', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 1;

  await semaphore.up(key, maximum);
  const response = await semaphore.get(key);
  t.is(response.Item.semvalue, 1);
});

test('Semaphore.down() cannot decrement the semaphore value below 0', async (t) => {
  const { semaphore, key } = t.context;

  try {
    await semaphore.down(key);
    t.fail('expected error to be thrown');
  } catch (err) {
    t.pass();
  }
});

test('Semaphore.down() decrements the semaphore value', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 1;

  await semaphore.up(key, maximum);
  await semaphore.down(key);
  const response = await semaphore.get(key);
  t.is(response.Item.semvalue, 0);
});

test('Semaphore.up() and Semaphore.down() properly update semaphore value', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 2;

  await semaphore.up(key, maximum);
  await semaphore.down(key);
  await semaphore.up(key, maximum);
  const response = await semaphore.get(key);
  t.is(response.Item.semvalue, 1);
});
