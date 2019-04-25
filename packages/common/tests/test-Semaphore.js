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

test('Semaphore.add() can increase the count up to the maximum', async (t) => {
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

test('Semaphore.add() cannot increment the count beyond the maximum', async (t) => {
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

test('Semaphore.add() cannot increment when maximum is 0', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 0;

  try {
    await semaphore.add(key, 1, maximum);
    t.fail('expected error to be thrown');
  } catch (err) {
    t.pass();
  }
});

test('Semaphore.up() can increment the count to the maximum', async (t) => {
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

test('Semaphore.up() cannot increment the count beyond the maximum', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 2;

  try {
    await Promise.all([
      semaphore.up(key, maximum),
      semaphore.up(key, maximum),
      semaphore.up(key, maximum),
    ]);
    t.fail('expected error to be thrown');
  } catch (err) {
    t.pass();
  }
});

test('Semaphore.up() and Semaphore.down() properly update semaphore value', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 2;

  try {
    await semaphore.up(key, maximum);
    await semaphore.up(key, maximum);
    await semaphore.down(key, maximum);
    await semaphore.up(key, maximum);
  } catch (err) {
    console.log(err);
    t.fail();
  }

  t.pass();
});
