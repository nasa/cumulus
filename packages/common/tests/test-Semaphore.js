'use strict';

const test = require('ava');
const { dynamodbDocClient } = require('../aws');
const Semaphore = require('../Semaphore');
const { randomId, randomString } = require('../test-utils');
// TODO: import from the package instead of relative path?
const { Manager } = require('../../api/models');

let manager;

test.before(async () => {
  process.env.semaphoreTable = randomString();
  manager = new Manager({
    tableName: process.env.semaphoreTable,
    tableHash: { name: 'key', type: 'S' }
  });
  await manager.createTable();
});

test.beforeEach(async (t) => {
  t.context.semaphore = new Semaphore(
    dynamodbDocClient(),
    process.env.semaphoreTable
  );
  t.context.key = randomId('key');
});

test.after.always(async () => {
  await manager.deleteTable();
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

test('Semaphore.up() can increment the semaphore value to the maximum', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 2;

  try {
    await Promise.all([
      semaphore.up(key, maximum),
      semaphore.up(key, maximum)
    ]);
  } catch (err) {
    console.log(err);
    t.fail();
  }

  t.pass();
});

test('Semaphore.up() cannot increment the semaphore value beyond the maximum', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 2;

  try {
    await Promise.all([
      semaphore.up(key, maximum),
      semaphore.up(key, maximum),
      semaphore.up(key, maximum)
    ]);
    t.fail('expected error to be thrown');
  } catch (err) {
    t.pass();
  }
});

test('Semaphore.down() cannot decrement the semaphore value below 0', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 1;

  try {
    await semaphore.down(key, maximum);
    t.fail('expected error to be thrown');
  } catch (err) {
    t.pass();
  }
});

test('Semaphore.down() decrements the semaphore value', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 1;

  await semaphore.up(key, maximum);
  await semaphore.down(key, maximum);
  const response = await semaphore.get(key);
  t.is(response.Item.semvalue, 0);
});

test('Semaphore.up() and Semaphore.down() properly update semaphore value', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 2;

  await semaphore.up(key, maximum);
  await semaphore.up(key, maximum);
  await semaphore.down(key, maximum);
  await semaphore.up(key, maximum);
  const response = await semaphore.get(key);
  t.is(response.Item.semvalue, 2);
});
