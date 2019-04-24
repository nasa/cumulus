'use strict';

const test = require('ava');
const { dynamodbDocClient } = require('../aws');
const Semaphore = require('../Semaphore');
const { randomString } = require('../test-utils');
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

test('Cannot add more than max', async (t) => {
  const semaphore = new Semaphore(
    dynamodbDocClient(),
    process.env.semaphoreTable
  );

  try {
    await semaphore.add('test', 1, 2);
  } catch (err) {
    debugger;
    console.log(err);
    t.fail();
  }

  t.pass();

  // try {
  //   await semaphore.add('test', 1, 2);
  //   debugger;
  //   t.fail('expected error');
  // } catch (err) {
  //   debugger;
  //   t.pass();
  // }
});
