'use strict';

const test = require('ava');
const { dynamodb, dynamodbDocClient } = require('../aws');
const Semaphore = require('../Semaphore');
const { ResourcesLockedError } = require('../errors');
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

test('Semaphore.create() initializes semaphore', async (t) => {
  const { semaphore, key } = t.context;

  await semaphore.create(key);
  const response = await semaphore.get(key);
  t.is(response.Item.semvalue, 0);
});

test('Semaphore.create() on existing semaphore does not throw an error', async (t) => {
  const { semaphore, key } = t.context;

  await semaphore.create(key);
  await t.notThrows(semaphore.create(key));
});

test('Semaphore.add() can increase the semaphore value up to the maximum', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 2;

  await t.notThrows(Promise.all([
    semaphore.add(key, 1, maximum),
    semaphore.add(key, 1, maximum)
  ]));
});

test('Semaphore.add() cannot increment the semaphore value beyond the maximum', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 1;

  const error = await t.throws(Promise.all([
    semaphore.add(key, 1, maximum),
    semaphore.add(key, 1, maximum)
  ]));
  t.true(error instanceof ResourcesLockedError);
});

test('Semaphore.add() cannot increment the semaphore value when maximum is 0', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 0;

  const error = await t.throws(semaphore.add(key, 1, maximum));
  t.true(error instanceof ResourcesLockedError);
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

  const error = await t.throws(semaphore.down(key));
  t.true(error instanceof ResourcesLockedError);
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

test('Semaphore.checkout() properly increments and then decrements semaphore value', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 1;
  const asyncFn = async () => {};

  await semaphore.checkout(key, 1, maximum, asyncFn);

  const response = await semaphore.get(key);
  t.is(response.Item.semvalue, 0);
});

test('Semaphore.checkout() throws error when trying to increment beyond the maximum', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 1;
  const asyncFn = async () => {};

  const error = await t.throws(semaphore.checkout(key, 2, maximum, asyncFn));

  t.true(error instanceof ResourcesLockedError);
});
