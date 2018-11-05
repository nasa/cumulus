'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const { Manager, Collection } = require('../../models');

let manager;
test.before(async () => {
  process.env.CollectionsTable = randomString();

  manager = new Manager({
    tableName: process.env.CollectionsTable,
    tableHash: { name: 'name', type: 'S' },
    tableRange: { name: 'version', type: 'S' }
  });

  await manager.createTable();
});

test.after.always(async () => {
  await manager.deleteTable();
});

test('Collection.exists() returns true when a record exists', async (t) => {
  const name = randomString();
  const version = randomString();

  await manager.create({ name, version });

  const collectionsModel = new Collection();

  t.true(await collectionsModel.exists(name, version));
});

test('Collection.exists() returns false when a record does not exist', async (t) => {
  const collectionsModel = new Collection();

  t.false(await collectionsModel.exists(randomString()));
});
