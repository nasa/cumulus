'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const { Manager, Provider } = require('../../models');

let manager;
test.before(async () => {
  process.env.ProvidersTable = randomString();

  manager = new Manager({
    tableName: process.env.ProvidersTable,
    tableHash: { name: 'id', type: 'S' }
  });

  await manager.createTable();
});

test.after.always(async () => {
  await manager.deleteTable();
});

test('Providers.exists() returns true when a record exists', async (t) => {
  const id = randomString();

  await manager.create({ id });

  const providersModel = new Provider();

  t.true(await providersModel.exists(id));
});

test('Providers.exists() returns false when a record does not exist', async (t) => {
  const providersModel = new Provider();

  t.false(await providersModel.exists(randomString()));
});
