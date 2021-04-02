const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  AsyncOperationPgModel,
  generateLocalTestDb,
  destroyLocalTestDb,
} = require('../../dist');

const { fakeAsyncOperationRecordFactory } = require('../../dist/test-utils');

const { migrationDir } = require('../../../../lambdas/db-migration');

const testDbName = `async_operation_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.asyncOperationPgModel = new AsyncOperationPgModel();
});

test.beforeEach((t) => {
  t.context.asyncOperationRecord = fakeAsyncOperationRecordFactory();
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('AsyncOperationPgModel.upsert() creates new async operation', async (t) => {
  const {
    knex,
    asyncOperationPgModel,
    asyncOperationRecord,
  } = t.context;

  await asyncOperationPgModel.upsert(knex, asyncOperationRecord);

  t.like(
    await asyncOperationPgModel.get(knex, asyncOperationRecord),
    asyncOperationRecord
  );
});

test('AsyncOperationPgModel.upsert() overwrites an async operation record', async (t) => {
  const {
    knex,
    asyncOperationPgModel,
    asyncOperationRecord,
  } = t.context;

  await asyncOperationPgModel.create(knex, asyncOperationRecord);

  const updatedRule = {
    ...asyncOperationRecord,
    description: cryptoRandomString({ length: 5 }),
  };

  await asyncOperationPgModel.upsert(knex, updatedRule);

  t.like(
    await asyncOperationPgModel.get(knex, {
      id: asyncOperationRecord.id,
    }),
    updatedRule
  );
});
