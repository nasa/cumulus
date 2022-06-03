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
const {
  indexAsyncOperation,
} = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');
// eslint-disable-next-line unicorn/import-index
const { updateAsyncOperation } = require('../index');

const testDbName = `async_operation_model_test_db_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  process.env = { ...process.env, ...localStackConnectionEnv, PG_DATABASE: testDbName };
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;

  t.context.asyncOperationPgModel = new AsyncOperationPgModel();

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.esAsyncOperationsClient = new Search(
    {},
    'asyncOperation',
    t.context.esIndex
  );
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
  await indexAsyncOperation(
    t.context.esClient,
    t.context.testAsyncOperation,
    t.context.esIndex
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
  await cleanupTestIndex(t.context);
});

test('updateAsyncOperation updates databases as expected', async (t) => {
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

  const asyncOpEsRecord = await t.context.esAsyncOperationsClient.get(
    t.context.testAsyncOperation.id
  );
  t.deepEqual(asyncOpEsRecord, {
    ...t.context.testAsyncOperation,
    _id: asyncOpEsRecord._id,
    timestamp: asyncOpEsRecord.timestamp,
    status,
    output: JSON.stringify(output),
    updatedAt: Number(updateTime),
  });
});

test('updateAsyncOperation updates records correctly when output is undefined', async (t) => {
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

test('updateAsyncOperation updates databases with correct timestamps', async (t) => {
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

test('updateAsyncOperation does not update PostgreSQL if write to Elasticsearch fails', async (t) => {
  const status = 'SUCCEEDED';
  const output = { foo: cryptoRandomString({ length: 5 }) };
  const updateTime = (Number(Date.now())).toString();

  const fakeEsClient = {
    update: () => {
      throw new Error('ES fail');
    },
  };

  await t.throwsAsync(
    updateAsyncOperation({
      status,
      output,
      envOverride: {
        asyncOperationId: t.context.asyncOperationId,
        ...localStackConnectionEnv,
        PG_DATABASE: testDbName,
        updateTime,
      },
      esClient: fakeEsClient,
    }),
    { message: 'ES fail' }
  );

  const asyncOperationPgRecord = await t.context.asyncOperationPgModel
    .get(
      t.context.testKnex,
      {
        id: t.context.asyncOperationId,
      }
    );
  t.like(asyncOperationPgRecord, t.context.testAsyncOperationPgRecord);

  const asyncOpEsRecord = await t.context.esAsyncOperationsClient.get(
    t.context.testAsyncOperation.id
  );
  t.deepEqual(asyncOpEsRecord, {
    ...t.context.testAsyncOperation,
    _id: asyncOpEsRecord._id,
    timestamp: asyncOpEsRecord.timestamp,
  });
});

test('updateAsyncOperation does not update Elasticsearch if write to PostgreSQL fails', async (t) => {
  const status = 'SUCCEEDED';
  const output = { foo: cryptoRandomString({ length: 5 }) };
  const updateTime = (Number(Date.now())).toString();

  const fakePgModel = {
    update: () => {
      throw new Error('PG fail');
    },
  };

  await t.throwsAsync(
    updateAsyncOperation({
      status,
      output,
      envOverride: {
        asyncOperationId: t.context.asyncOperationId,
        ...localStackConnectionEnv,
        PG_DATABASE: testDbName,
        updateTime,
      },
      asyncOperationPgModel: fakePgModel,
    }),
    { message: 'PG fail' }
  );

  const asyncOperationPgRecord = await t.context.asyncOperationPgModel
    .get(
      t.context.testKnex,
      {
        id: t.context.asyncOperationId,
      }
    );
  t.like(asyncOperationPgRecord, t.context.testAsyncOperationPgRecord);

  const asyncOpEsRecord = await t.context.esAsyncOperationsClient.get(
    t.context.testAsyncOperation.id
  );
  t.deepEqual(asyncOpEsRecord, {
    ...t.context.testAsyncOperation,
    _id: asyncOpEsRecord._id,
    timestamp: asyncOpEsRecord.timestamp,
  });
});
