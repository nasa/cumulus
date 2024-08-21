'use strict';

const test = require('ava');
const { v4: uuidv4 } = require('uuid');
const cryptoRandomString = require('crypto-random-string');
const {
  localStackConnectionEnv,
  destroyLocalTestDb,
  generateLocalTestDb,
  AsyncOperationPgModel,
  translateApiAsyncOperationToPostgresAsyncOperation,
  translatePostgresAsyncOperationToApiAsyncOperation,
  migrationDir,
} = require('@cumulus/db');
// eslint-disable-next-line unicorn/import-index
const { updateAsyncOperation } = require('../index');

const testDbName = `async_operation_model_test_db_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  process.env = { ...process.env, ...localStackConnectionEnv, PG_DATABASE: testDbName };
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;

  t.context.asyncOperationPgModel = new AsyncOperationPgModel();
});

test.beforeEach(async (t) => {
  t.context.asyncOperationId = uuidv4();

  t.context.testAsyncOperation = {
    id: t.context.asyncOperationId,
    description: 'test description',
    operationType: 'ES Index',
    status: 'RUNNING',
    createdAt: Date.now(),
  };
  t.context.testAsyncOperationPgRecord = translateApiAsyncOperationToPostgresAsyncOperation(
    t.context.testAsyncOperation
  );
  await t.context.asyncOperationPgModel.create(
    t.context.testKnex,
    t.context.testAsyncOperationPgRecord
  );
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    knex: t.context.testKnex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
});

test('updateAsyncOperation updates database as expected', async (t) => {
  const status = 'SUCCEEDED';
  const output = { foo: 'bar' };
  const updateTime = (Number(Date.now())).toString();
  const result = await updateAsyncOperation({
    status,
    output,
    envOverride: {
      asyncOperationId: t.context.asyncOperationId,
      ...localStackConnectionEnv,
      PG_DATABASE: testDbName,
      updateTime,
    },
  });

  const asyncOperationPgRecord = await t.context.asyncOperationPgModel
    .get(
      t.context.testKnex,
      {
        id: t.context.asyncOperationId,
      }
    );

  t.like(result, translatePostgresAsyncOperationToApiAsyncOperation(asyncOperationPgRecord));
  t.like(asyncOperationPgRecord, {
    ...t.context.testAsyncOperationPgRecord,
    id: t.context.asyncOperationId,
    status,
    output,
    updated_at: new Date(Number(updateTime)),
  });
});

test('updateAsyncOperation updates record correctly when output is undefined', async (t) => {
  const status = 'SUCCEEDED';
  const output = undefined;
  const updateTime = (Number(Date.now())).toString();
  const result = await updateAsyncOperation({
    status,
    output,
    envOverride: {
      asyncOperationId: t.context.asyncOperationId,
      ...localStackConnectionEnv,
      PG_DATABASE: testDbName,
      updateTime,
    },
  });

  const asyncOperationPgRecord = await t.context.asyncOperationPgModel
    .get(
      t.context.testKnex,
      {
        id: t.context.asyncOperationId,
      }
    );

  t.like(result, translatePostgresAsyncOperationToApiAsyncOperation(asyncOperationPgRecord));
  t.like(asyncOperationPgRecord, {
    ...t.context.testAsyncOperationPgRecord,
    id: t.context.asyncOperationId,
    status,
    output: null,
    updated_at: new Date(Number(updateTime)),
  });
});

test('updateAsyncOperation updates database with correct timestamps', async (t) => {
  const status = 'SUCCEEDED';
  const output = { foo: 'bar' };
  const updateTime = (Number(Date.now())).toString();

  await updateAsyncOperation({
    status,
    output,
    envOverride: {
      asyncOperationId: t.context.asyncOperationId,
      ...localStackConnectionEnv,
      PG_DATABASE: testDbName,
      updateTime,
    },
  });

  const asyncOperationPgRecord = await t.context.asyncOperationPgModel
    .get(
      t.context.testKnex,
      {
        id: t.context.asyncOperationId,
      }
    );
  t.is(asyncOperationPgRecord.updated_at.getTime().toString(), updateTime);
});
