const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { RecordDoesNotExist } = require('@cumulus/errors');

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
  t.context.basePgModel = new BasePgModel({ tableName: t.context.tableName });
});

test.after.always(async (t) => {
  await t.context.knex.schema.dropTable(t.context.tableName);
});

test('BasePgModel.create() creates record and returns cumulus_id by default', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });

  const queryResult = await basePgModel.create(knex, { info });

  const record = await knex(tableName).where({ info }).first();
  t.deepEqual(
    record,
    {
      cumulus_id: queryResult[0],
      info,
    }
  );
});

test('BasePgModel.create() works with knex transaction', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });

  const queryResult = await knex.transaction(
    (trx) => basePgModel.create(trx, { info })
  );

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
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  await knex(tableName).insert({ info });
  t.like(
    await basePgModel.get(knex, { info }),
    {
      info,
    }
  );
});

test('BasePgModel.get() works with knex transaction', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  await knex(tableName).insert({ info });
  t.like(
    await knex.transaction((trx) => basePgModel.get(trx, { info })),
    {
      info,
    }
  );
});

test('BasePgModel.get() throws an error when a record is not found', async (t) => {
  const { knex, basePgModel } = t.context;
  const info = cryptoRandomString({ length: 10 });
  await t.throwsAsync(
    knex.transaction((trx) => basePgModel.get(trx, { info })),
    { instanceOf: RecordDoesNotExist }
  );
});

test('BasePgModel.getRecordCumulusId() returns correct value', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  const [recordCumulusId] = await knex(tableName)
    .insert({ info })
    .returning('cumulus_id');
  t.is(
    await basePgModel.getRecordCumulusId(knex, { info }),
    recordCumulusId
  );
});

test('BasePgModel.getRecordCumulusId() works with knex transaction', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  const [recordCumulusId] = await knex(tableName)
    .insert({ info })
    .returning('cumulus_id');
  t.is(
    await knex.transaction(
      (trx) => basePgModel.getRecordCumulusId(trx, { info })
    ),
    recordCumulusId
  );
});

test('BasePgModel.getRecordCumulusId() throws RecordDoesNotExist error for missing record', async (t) => {
  const { knex, basePgModel } = t.context;
  const info = cryptoRandomString({ length: 5 });
  await t.throwsAsync(
    basePgModel.getRecordCumulusId(knex, { info }),
    { instanceOf: RecordDoesNotExist }
  );
});

test('BasePgModel.exists() correctly returns true', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  await knex(tableName).insert({ info });
  t.true(await basePgModel.exists(knex, { info }));
});

test('BasePgModel.exists() works with knex transaction', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });
  await knex(tableName).insert({ info });
  t.true(await knex.transaction(
    (trx) => basePgModel.exists(trx, { info })
  ));
});

test('BasePgModel.exists() correctly returns false', async (t) => {
  const { knex, basePgModel } = t.context;
  const info = cryptoRandomString({ length: 5 });
  t.false(await basePgModel.exists(knex, { info }));
});

test('BasePgModel.delete() correctly deletes records', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });

  // Insert the record and validate that it exists in the table
  const [recordCumulusId] = await knex(tableName)
    .insert({ info })
    .returning('cumulus_id');

  t.true(
    await basePgModel.exists(knex, { cumulus_id: recordCumulusId })
  );

  // Delete the record and validate that it's gone
  t.is(
    await basePgModel.delete(knex, { cumulus_id: recordCumulusId }),
    1
  );

  t.false(await basePgModel.exists(knex, { cumulus_id: recordCumulusId }));
});

test('BasePgModel.delete() works with knex transaction', async (t) => {
  const { knex, basePgModel, tableName } = t.context;
  const info = cryptoRandomString({ length: 5 });

  const [recordCumulusId] = await knex(tableName)
    .insert({ info })
    .returning('cumulus_id');

  t.is(await knex.transaction(
    (trx) => basePgModel.delete(trx, { cumulus_id: recordCumulusId })
  ), 1);

  // validate that the record is not in the table
  t.false(await basePgModel.exists(knex, { cumulus_id: recordCumulusId }));
});
