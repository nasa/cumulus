const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  localStackConnectionEnv,
  getKnexClient,
  ExecutionPgModel,
  fakeExecutionRecordFactory,
} = require('../../dist');

const { migrationDir } = require('../../../../lambdas/db-migration');

const testDbName = `execution_${cryptoRandomString({ length: 10 })}`;
const testDbUser = 'postgres';

test.before(async (t) => {
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

  // create tables
  await t.context.knex.migrate.latest();

  t.context.executionPgModel = new ExecutionPgModel();
});

test.beforeEach((t) => {
  t.context.executionRecord = fakeExecutionRecordFactory();
});

test.after.always(async (t) => {
  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${testDbName}"`);
  await t.context.knexAdmin.destroy();
});

test('ExecutionPgModel.upsert() creates new running execution', async (t) => {
  const {
    knex,
    executionPgModel,
    executionRecord,
  } = t.context;

  executionRecord.status = 'running';

  await executionPgModel.upsert(knex, executionRecord);

  t.like(
    await executionPgModel.get(knex, { arn: executionRecord.arn }),
    executionRecord
  );
});
