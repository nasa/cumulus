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
const { RecordAlreadyMigrated } = require('@cumulus/errors');

const {
  migrateAsyncOperationRecord,
  migrateAsyncOperations,
} = require('../dist/lambda/async-operations');

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');

const testDbName = `data_migration_1_${cryptoRandomString({ length: 10 })}`;
const testDbUser = 'postgres';

const generateFakeAsyncOperation = (params) => ({
  id: uuid(),
  description: 'unittest async operation',
  operationType: 'ES Index',
  output: '[\"S6A_P4_2__HR_STD__NT_002_056_20180621T022306_20180621T031436_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_057_20180621T031436_20180621T041048_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_059_20180621T050701_20180621T060314_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_073_20180621T181402_20180621T191015_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_068_20180621T133257_20180621T142910_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_070_20180621T152523_20180621T162136_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_066_20180621T114031_20180621T123644_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_061_20180621T065927_20180621T075540_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_071_20180621T162136_20180621T171749_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_069_20180621T142910_20180621T152523_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_063_20180621T085153_20180621T094806_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_062_20180621T075540_20180621T085153_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_075_20180621T200627_20180621T210002_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_085_20180622T052836_20180622T062449_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_082_20180622T024602_20180622T033610_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_083_20180622T033610_20180622T043223_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_086_20180622T062449_20180622T072102_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_088_20180622T081715_20180622T091328_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_078_20180621T225506_20180621T235119_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_098_20180622T173924_20180622T183536_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_091_20180622T110553_20180622T120206_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_092_20180622T120206_20180622T125819_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_104_20180622T231641_20180623T001254_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_105_20180623T001254_20180623T010907_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_094_20180622T135432_20180622T145045_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_096_20180622T154658_20180622T164311_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_095_20180622T145045_20180622T154658_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_106_20180623T010907_20180623T020520_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_108_20180623T030856_20180623T035745_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_110_20180623T045358_20180623T055011_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_113_20180623T074237_20180623T075141_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_101_20180622T202802_20180622T212224_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_102_20180622T212914_20180622T222028_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_112_20180623T071142_20180623T074237_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_115_20180623T093503_20180623T103115_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_122_20180623T160833_20180623T170446_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_123_20180623T170446_20180623T180059_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_124_20180623T180059_20180623T185711_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_129_20180623T224203_20180623T233816_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_131_20180624T003429_20180624T011248_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_117_20180623T112728_20180623T122341_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_116_20180623T103115_20180623T112728_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_119_20180623T131954_20180623T141607_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_118_20180623T122341_20180623T131954_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_120_20180623T141607_20180623T151220_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_126_20180623T195521_20180623T204937_F00_prevalidated\",\"S6A_P4_2__HR_STD__NT_002_127_20180623T204937_20180623T214520_F00_prevalidated\"]',
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
    omit(createdRecord, ['cumulus_id']),
    omit({
      ...fakeAsyncOp,
      operation_type: fakeAsyncOp.operationType,
      task_arn: fakeAsyncOp.taskArn,
      output: JSON.parse(fakeAsyncOp.output),
      created_at: new Date(fakeAsyncOp.createdAt),
      updated_at: new Date(fakeAsyncOp.updatedAt),
    },
    ['createdAt', 'updatedAt', 'operationType', 'taskArn'])
  );
});

test.serial('migrateAsyncOperationRecord migrates asyncOperation record with undefined nullables', async (t) => {
  const fakeAsyncOp = generateFakeAsyncOperation();
  delete fakeAsyncOp.output;
  delete fakeAsyncOp.taskArn;
  await migrateAsyncOperationRecord(fakeAsyncOp, t.context.knex);

  const createdRecord = await t.context.knex.queryBuilder()
    .select()
    .table('async_operations')
    .where({ id: fakeAsyncOp.id })
    .first();

  t.deepEqual(
    omit(createdRecord, ['cumulus_id']),
    omit({
      ...fakeAsyncOp,
      operation_type: fakeAsyncOp.operationType,
      output: null,
      task_arn: null,
      created_at: new Date(fakeAsyncOp.createdAt),
      updated_at: new Date(fakeAsyncOp.updatedAt),
    },
    ['createdAt', 'updatedAt', 'operationType'])
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
