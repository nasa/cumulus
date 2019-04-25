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

test.after.always(async () => {
  await manager.deleteTable();
});

test('Can add up to the max', async (t) => {
  const semaphore = new Semaphore(
    dynamodbDocClient(),
    process.env.semaphoreTable
  );
  const key = randomId('key');

  try {
    await Promise.all([
      semaphore.up(key),
      semaphore.up(key)
    ]);
  } catch (err) {
    console.log(err);
    t.fail();
  }

  t.pass();
});

test('Cannot add more than max', async (t) => {
  const semaphore = new Semaphore(
    dynamodbDocClient(),
    process.env.semaphoreTable
  );
  const key = randomId('key');

  try {
    await Promise.all([
      semaphore.up(key, 2),
      semaphore.up(key, 2),
      semaphore.up(key, 2)
    ]);
    t.fail('expected error');
  } catch (err) {
    t.pass();
  }
});

test.todo('Use 0 as max');
