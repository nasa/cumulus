const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { localStackConnectionEnv } = require('../dist/config');
const { getKnexClient } = require('../dist/connection');
const { getDbClient, doesRecordExist } = require('../dist/database');

test.before(async (t) => {
  t.context.knex = await getKnexClient({
    env: localStackConnectionEnv,
  });
  t.context.tableName = cryptoRandomString({ length: 10 });
  await t.context.knex.schema.createTable(t.context.tableName, (table) => {
    table.text('key').primary();
  });
  t.context.dbClient = getDbClient(t.context.knex, t.context.tableName);
});

test.after.always(async (t) => {
  await t.context.knex.schema.dropTable(t.context.tableName);
});

test('doesExecutionExist correctly returns true', async (t) => {
  const { dbClient, knex, tableName } = t.context;
  const key = cryptoRandomString({ length: 5 });
  await dbClient.insert({ key });
  t.true(await doesRecordExist({ key }, knex, tableName));
});

test('doesExecutionExist correctly returns false', async (t) => {
  const { knex, tableName } = t.context;
  const key = cryptoRandomString({ length: 5 });
  t.false(await doesRecordExist({ key }, knex, tableName));
});
