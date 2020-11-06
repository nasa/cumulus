const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { localStackConnectionEnv } = require('../dist/config');
const { getKnexClient } = require('../dist/connection');
const { doesRecordExist, isRecordDefined } = require('../dist/database');

test.before(async (t) => {
  t.context.knex = await getKnexClient({
    env: localStackConnectionEnv,
  });
  t.context.tableName = cryptoRandomString({ length: 10 });
  await t.context.knex.schema.createTable(t.context.tableName, (table) => {
    table.text('key').primary();
  });
});

test.after.always(async (t) => {
  await t.context.knex.schema.dropTable(t.context.tableName);
});

test('doesRecordExist correctly returns true', async (t) => {
  const { knex, tableName } = t.context;
  const key = cryptoRandomString({ length: 5 });
  await knex(tableName).insert({ key });
  t.true(await doesRecordExist({ key }, knex, tableName));
});

test('doesRecordExist correctly returns false', async (t) => {
  const { knex, tableName } = t.context;
  const key = cryptoRandomString({ length: 5 });
  t.false(await doesRecordExist({ key }, knex, tableName));
});

test('isRecordDefined correctly returns true', async (t) => {
  t.true(isRecordDefined({ key: 'value' }));
});

test('isRecordDefined correctly returns false', async (t) => {
  t.false(isRecordDefined(undefined));
});
