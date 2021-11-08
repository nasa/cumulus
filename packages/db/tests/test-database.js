const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  isRecordDefined,
} = require('../dist/database');

const {
  localStackConnectionEnv,
  createRejectableTransaction,
  getKnexClient,
  BasePgModel,
} = require('../dist');

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

test('isRecordDefined correctly returns true', (t) => {
  t.true(isRecordDefined({ info: 'value' }));
});

test('isRecordDefined correctly returns false', (t) => {
  t.false(isRecordDefined(undefined));
});

test('createRejectableTransaction throws on bad query/transaction rollback', async (t) => {
  const { knex, basePgModel } = t.context;
  await t.throwsAsync(
    createRejectableTransaction(
      knex,
      async (trx) => {
        await basePgModel.create(trx, { fakeColumn: 'foobar' });
      }
    )
  );
});

test('createRejectableTransaction does not throw on good query', async (t) => {
  const { knex, basePgModel } = t.context;
  await t.notThrowsAsync(
    createRejectableTransaction(
      knex,
      async (trx) => {
        await basePgModel.create(trx, { info: 'foobar' });
      }
    )
  );
});
