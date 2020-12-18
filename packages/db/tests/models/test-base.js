const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { localStackConnectionEnv } = require('../../dist/config');
const { getKnexClient } = require('../../dist/connection');
const { BasePgModel } = require('../../dist/models/base');

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

test('BasePgModel.create() creates record and returns cumulus_id by default', async (t) => {
  const { knex, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });

  const model = new BasePgModel({ tableName });
  const queryResult = await model.create(knex, { info });

  const record = await knex(tableName).where({ info }).first();
  t.deepEqual(
    record,
    {
      cumulus_id: queryResult[0],
      info,
    }
  );
});

test('BasePgModel.get() returns correct record', async (t) => {
  const { knex, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  await knex(tableName).insert({ info });
  const model = new BasePgModel({ tableName });
  t.like(
    await model.get(knex, { info }),
    {
      info,
    }
  );
});

test('BasePgModel.exists() correctly returns true', async (t) => {
  const { knex, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  await knex(tableName).insert({ info });
  const model = new BasePgModel({ tableName });
  t.true(await model.exists(knex, { info }));
});

test('BasePgModel.exists() correctly returns false', async (t) => {
  const { knex, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  const model = new BasePgModel({ tableName });
  t.false(await model.exists(knex, { info }));
});
