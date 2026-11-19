const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  destroyLocalTestDb,
  generateLocalTestDb,
  AsyncOperationPgModel,
  fakeAsyncOperationRecordFactory,
  migrationDir,
} = require('../../dist');

const testDbName = `export_table_op_type_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;
  t.context.asyncOperationPgModel = new AsyncOperationPgModel();
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test('async_operations.operation_type CHECK constraint allows "Export Table"', async (t) => {
  const record = fakeAsyncOperationRecordFactory({ operation_type: 'Export Table' });
  await t.notThrowsAsync(
    t.context.asyncOperationPgModel.create(t.context.knex, record)
  );
});

test('async_operations.operation_type CHECK constraint still rejects unknown values', async (t) => {
  const record = fakeAsyncOperationRecordFactory({ operation_type: 'Not A Real Operation Type' });
  await t.throwsAsync(
    t.context.asyncOperationPgModel.create(t.context.knex, record),
    { message: /violates check constraint/ }
  );
});
