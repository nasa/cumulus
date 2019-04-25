'use strict';

const test = require('ava');
const { dynamodbDocClient } = require('../aws');
const Semaphore = require('../Semaphore');
const { randomId, randomString } = require('../test-utils');
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

  try {
    await Promise.all([
      semaphore.add(key, 1, 2),
      semaphore.add(key, 1, 2)
    ]);
  } catch (err) {
    console.log(err);
    t.fail();
  }

  t.pass();
});

test('Semaphore.add() cannot increment the count beyond the maximum', async (t) => {
  const { semaphore, key } = t.context;

  try {
    await Promise.all([
      semaphore.add(key, 1, 1),
      semaphore.add(key, 1, 1)
    ]);
    t.fail('expected error to be thrown');
  } catch (err) {
    t.pass();
  }
});

test('Semaphore.up() can increment the count to the maximum', async (t) => {
  const { semaphore, key } = t.context;

  try {
    await Promise.all([
      semaphore.up(key, 2),
      semaphore.up(key, 2)
    ]);
  } catch (err) {
    console.log(err);
    t.fail();
  }

  t.pass();
});

test('Semaphore.up() cannot increment the count beyond the maximum', async (t) => {
  const { semaphore, key } = t.context;

  try {
    await Promise.all([
      semaphore.up(key, 2),
      semaphore.up(key, 2),
      semaphore.up(key, 2)
    ]);
    t.fail('expected error to be thrown');
  } catch (err) {
    t.pass();
  }
});

test.todo('Use 0 as max');
