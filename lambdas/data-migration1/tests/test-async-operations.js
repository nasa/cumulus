const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');
const test = require('ava');
const uuid = require('uuid/v4');

const AsyncOperation = require('@cumulus/api/models/async-operation');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');

const {
  migrateAsyncOperationRecord,
  migrateAsyncOperations,
} = require('../dist/lambda/async-operations');

const { RecordAlreadyMigrated } = require('../dist/lambda/errors');
// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');

const testDbName = `data_migration_1_${cryptoRandomString({ length: 10 })}`;
const testDbUser = 'postgres';

const generateFakeAsyncOperation = (params) => ({
  id: uuid(),
  description: 'unittest async operation',
  operationType: 'ES Index',
  output: '{ "output": "test" }',
  status: 'SUCCEEDED',
  taskArn: 'arn:aws:ecs:task:1234',
  createdAt: (Date.now() - 1000),
  updatedAt: Date.now(),
  ...params,
});

let asyncOperationsModel;

test.before(async (t) => {
  process.env.stackName = cryptoRandomString({ length: 10 });
  process.env.system_bucket = cryptoRandomString({ length: 10 });
  process.env.AsyncOperationsTable = cryptoRandomString({ length: 10 });

  await createBucket(process.env.system_bucket);

  asyncOperationsModel = new AsyncOperation({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
  });
  await asyncOperationsModel.createTable();

  t.context.knexAdmin = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      migrationDir,
    },
  });

  await t.context.knexAdmin.raw(`create database "${testDbName}";`);
  await t.context.knexAdmin.raw(`grant all privileges on database "${testDbName}" to "${testDbUser}"`);

  t.context.knex = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      PG_DATABASE: testDbName,
      migrationDir,
    },
  });

  await t.context.knex.migrate.latest();
});

test.afterEach.always(async (t) => {
  await t.context.knex('async_operations').del();
});

test.after.always(async (t) => {
  await asyncOperationsModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${testDbName}"`);
  await t.context.knexAdmin.destroy();
});

test.serial('migrateAsyncOperationRecord correctly migrates asyncOperation record', async (t) => {
  const fakeAsyncOp = generateFakeAsyncOperation();
  await migrateAsyncOperationRecord(fakeAsyncOp, t.context.knex);

  const createdRecord = await t.context.knex.queryBuilder()
    .select()
    .table('async_operations')
    .where({ id: fakeAsyncOp.id })
    .first();

  t.deepEqual(
    omit(createdRecord, ['cumulusId']),
    omit({
      ...fakeAsyncOp,
      output: JSON.parse(fakeAsyncOp.output),
      created_at: new Date(fakeAsyncOp.createdAt),
      updated_at: new Date(fakeAsyncOp.updatedAt),
    },
    ['createdAt', 'updatedAt'])
  );
});

test.serial('migrateAsyncOperationRecord throws RecordAlreadyMigrated error for already migrated record', async (t) => {
  const fakeAsyncOp = generateFakeAsyncOperation();

  await migrateAsyncOperationRecord(fakeAsyncOp, t.context.knex);
  await t.throwsAsync(
    migrateAsyncOperationRecord(fakeAsyncOp, t.context.knex),
    { instanceOf: RecordAlreadyMigrated }
  );
});

test.serial('migrateAsyncOperations processes multiple async operations', async (t) => {
  const fakeAsyncOp1 = generateFakeAsyncOperation();
  const fakeAsyncOp2 = generateFakeAsyncOperation();

  await Promise.all([
    asyncOperationsModel.create(fakeAsyncOp1),
    asyncOperationsModel.create(fakeAsyncOp2),
  ]);
  t.teardown(() => Promise.all([
    asyncOperationsModel.delete({ id: fakeAsyncOp1.id }),
    asyncOperationsModel.delete({ id: fakeAsyncOp2.id }),
  ]));

  const migrationSummary = await migrateAsyncOperations(process.env, t.context.knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 2,
    skipped: 0,
    failed: 0,
    success: 2,
  });
  const records = await t.context.knex.queryBuilder().select().table('async_operations');
  t.is(records.length, 2);
});

test.serial('migrateAsyncOperations processes all non-failing records', async (t) => {
  const fakeAsyncOp1 = generateFakeAsyncOperation();
  const fakeAsyncOp2 = generateFakeAsyncOperation();

  // remove required source field so that record will fail
  delete fakeAsyncOp1.status;

  await Promise.all([
    // Have to use Dynamo client directly because creating
    // via model won't allow creation of an invalid record
    dynamodbDocClient().put({
      TableName: process.env.AsyncOperationsTable,
      Item: fakeAsyncOp1,
    }).promise(),
    asyncOperationsModel.create(fakeAsyncOp2),
  ]);
  t.teardown(() => Promise.all([
    asyncOperationsModel.delete({ id: fakeAsyncOp1.id }),
    asyncOperationsModel.delete({ id: fakeAsyncOp2.id }),
  ]));

  const migrationSummary = await migrateAsyncOperations(process.env, t.context.knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 2,
    skipped: 0,
    failed: 1,
    success: 1,
  });
  const records = await t.context.knex.queryBuilder().select().table('async_operations');
  t.is(records.length, 1);
});
