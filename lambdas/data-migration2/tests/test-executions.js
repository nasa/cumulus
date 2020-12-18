const omit = require('lodash/omit');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const Execution = require('@cumulus/api/models/executions');
const { fakeExecutionFactoryV2 } = require('@cumulus/api/lib/testUtils');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');
// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');

const {
  migrateExecutionRecord,
  migrateExecutions,
} = require('../dist/lambda/executions');

const executionOmitList = ['createdAt', 'updatedAt', 'finalPayload', 'originalPayload', 'parentArn', 'type', 'execution', 'name'];

const testDbName = `data_migration_2_${cryptoRandomString({ length: 10 })}`;
const testDbUser = 'postgres';

process.env.stackName = cryptoRandomString({ length: 10 });
process.env.system_bucket = cryptoRandomString({ length: 10 });
process.env.ExecutionsTable = cryptoRandomString({ length: 10 });

const executionsModel = new Execution();

test.before(async (t) => {
  await createBucket(process.env.system_bucket);
  await executionsModel.createTable();

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

  t.context.existingExecution = await executionsModel.create(fakeExecutionFactoryV2());
});

test.afterEach.always(async (t) => {
  await t.context.knex('executions').del();
});

test.after.always(async (t) => {
  await executionsModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${testDbName}"`);
  await t.context.knexAdmin.destroy();
});

test('migrateExecutionRecord correctly migrates execution record', async (t) => {
  const { existingExecution } = t.context;

  // migrate the existing dynamo execution to postgres so
  // we can use it as the parent for the next execution
  await migrateExecutionRecord(existingExecution, t.context.knex);
  const existingPostgresExecution = await t.context.knex.queryBuilder()
    .select()
    .table('executions')
    .where({ arn: existingExecution.arn })
    .first();

  // Create new Dynamo execution to be migrated to postgres
  const newExecution = fakeExecutionFactoryV2({ parentArn: existingExecution.arn });

  await migrateExecutionRecord(newExecution, t.context.knex);
  const createdRecord = await t.context.knex.queryBuilder()
    .select()
    .table('executions')
    .where({ arn: newExecution.arn })
    .first();

  t.deepEqual(
    omit(createdRecord, ['cumulus_id']),
    omit(
      {
        ...newExecution,
        async_operation_cumulus_id: null,
        collection_cumulus_id: null,
        cumulus_version: null,
        url: null,
        parent_cumulus_id: existingPostgresExecution.cumulus_id,
        workflow_name: newExecution.name,
        original_payload: newExecution.originalPayload,
        final_payload: newExecution.finalPayload,
        created_at: new Date(newExecution.createdAt),
        updated_at: new Date(newExecution.updatedAt),
        timestamp: new Date(newExecution.timestamp),
      },
      executionOmitList
    )
  );
});

test('migrateExecutionRecord throws error on invalid source data from Dynamo', async (t) => {

});

test('migrateExecutionRecord handles nullable fields on source execution data', async (t) => {

});

test('migrateExecutionRecord ignores extraneous fields from Dynamo', async (t) => {

});

test('migrateExecutionRecord skips already migrated record', async (t) => {

});
