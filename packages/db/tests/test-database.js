const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { RecordDoesNotExist } = require('@cumulus/errors');

const { localStackConnectionEnv } = require('../dist/config');
const { getKnexClient } = require('../dist/connection');
const {
  doesRecordExist,
  isRecordDefined,
  getRecordCumulusId,
} = require('../dist/database');

test.before(async (t) => {
  t.context.knex = await getKnexClient({
    env: localStackConnectionEnv,
  });
  t.context.tableName = cryptoRandomString({ length: 10 });
  await t.context.knex.schema.createTable(t.context.tableName, (table) => {
    table.increments('cumulus_id').primary();
    table.text('info');
  });
});

test.after.always(async (t) => {
  await t.context.knex.schema.dropTable(t.context.tableName);
});

test('doesRecordExist correctly returns true', async (t) => {
  const { knex, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  await knex(tableName).insert({ info });
  t.true(await doesRecordExist({ info }, knex, tableName));
});

test('doesRecordExist correctly returns false', async (t) => {
  const { knex, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  t.false(await doesRecordExist({ info }, knex, tableName));
});

test('isRecordDefined correctly returns true', async (t) => {
  t.true(isRecordDefined({ info: 'value' }));
});

test('isRecordDefined correctly returns false', async (t) => {
  t.false(isRecordDefined(undefined));
});

test('getRecordCumulusId returns correct cumulus_id', async (t) => {
  const { knex, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  // eslint-disable-next-line camelcase
  const [cumulus_id] = await knex(tableName)
    .insert({ info })
    .returning('cumulus_id');
  t.is(
    await getRecordCumulusId(
      { info },
      tableName,
      knex
    ),
    cumulus_id
  );
});

test('getRecordCumulusId throws RecordDoesNotExist error if record does not eixst', async (t) => {
  const { knex, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  await t.throwsAsync(
    getRecordCumulusId(
      { info },
      tableName,
      knex
    ),
    { instanceOf: RecordDoesNotExist }
  );
});
