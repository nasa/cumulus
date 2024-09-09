const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const uuid = require('uuid/v4');

const AsyncOperation = require('@cumulus/api/models/async-operation');

const {
  createBucket,
  putJsonS3Object,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');

const {
  generateLocalTestDb,
  destroyLocalTestDb,
  localStackConnectionEnv,
} = require('@cumulus/db');

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');
const { handler } = require('../dist/lambda');
const testDbName = `data_migration_1_${cryptoRandomString({ length: 10 })}`;
const workflow = cryptoRandomString({ length: 10 });

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
    stackName: cryptoRandomString({ length: 10 }),
    system_bucket: cryptoRandomString({ length: 10 }),
    AsyncOperationsTable: cryptoRandomString({ length: 10 }),
  };

  await createBucket(process.env.system_bucket);

  const workflowfile = `${process.env.stackName}/workflows/${workflow}.json`;
  const messageTemplateKey = `${process.env.stackName}/workflow_template.json`;

  t.context.asyncOperationsModel = new AsyncOperation({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
  });

  await Promise.all([
    t.context.asyncOperationsModel.createTable(),
  ]);

  await Promise.all([
    putJsonS3Object(
      process.env.system_bucket,
      messageTemplateKey,
      { meta: 'meta' }
    ),
    putJsonS3Object(
      process.env.system_bucket,
      workflowfile,
      { testworkflow: 'workflow-config' }
    ),
  ]);
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
});

test.after.always(async (t) => {
  await t.context.asyncOperationsModel.deleteTable();

  await recursivelyDeleteS3Bucket(process.env.system_bucket);

  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test('handler migrates async operations', async (t) => {
  const { asyncOperationsModel } = t.context;

  const fakeAsyncOperation = {
    id: uuid(),
    description: 'unittest async operation',
    operationType: 'ES Index',
    output: '{ "output": "test" }',
    status: 'SUCCEEDED',
    taskArn: 'arn:aws:ecs:task:1234',
    createdAt: (Date.now() - 1000),
    updatedAt: Date.now(),
  };

  await Promise.all([
    asyncOperationsModel.create(fakeAsyncOperation),
  ]);

  t.teardown(() => asyncOperationsModel.delete({ id: fakeAsyncOperation.id }));

  const call = await handler({});
  const expected = {
    MigrationSummary: {
      async_operations: {
        failed: 0,
        migrated: 1,
        skipped: 0,
        total_dynamo_db_records: 1,
      },
    },
  };
  t.deepEqual(call, expected);
});
