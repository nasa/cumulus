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

  // make source record invalid
  delete newExecution.arn;

  await t.throwsAsync(migrateExecutionRecord(newExecution, t.context.knex));
});

<<<<<<< HEAD
test.serial('migrateExecutionRecord handles nullable fields on source execution data', async (t) => {
  const newExecution = fakeExecutionFactoryV2();

  // // remove nullable fields
  delete newExecution.asyncOperationId;
  delete newExecution.collectionId;
  delete newExecution.tasks;
  delete newExecution.error;
  delete newExecution.duration;
  delete newExecution.originalPayload;
  delete newExecution.finalPayload;
  delete newExecution.timestamp;
  delete newExecution.parentArn;
  delete newExecution.type;
  delete newExecution.cumulusVersion;

  await migrateExecutionRecord(newExecution, t.context.knex);

  const createdRecord = await t.context.knex.queryBuilder()
    .select()
    .table('executions')
    .where({ arn: newExecution.arn })
    .first();
=======
test('migrateExecutionRecord handles nullable fields on source execution data', async (t) => {
>>>>>>> 5c0fb5768... CUMULUS-2188 postgres model definition for executions with tests

  assertPgExecutionMatches(t, newExecution, createdRecord, {
    duration: null,
    error: null,
    final_payload: null,
    original_payload: null,
    tasks: null,
    timestamp: null,
    workflow_name: null,
    cumulus_version: null,
  });
});

<<<<<<< HEAD
test.serial('migrateExecutionRecord throws RecordAlreadyMigrated error for already migrated record', async (t) => {
  const newExecution = fakeExecutionFactoryV2({ parentArn: undefined });
=======
test('migrateExecutionRecord ignores extraneous fields from Dynamo', async (t) => {
>>>>>>> 5c0fb5768... CUMULUS-2188 postgres model definition for executions with tests

  await migrateExecutionRecord(newExecution, t.context.knex);
  await t.throwsAsync(
    migrateExecutionRecord(newExecution, t.context.knex),
    { instanceOf: RecordAlreadyMigrated }
  );
});

<<<<<<< HEAD
test.serial('migrateExecutions skips already migrated record', async (t) => {
  const newExecution = fakeExecutionFactoryV2({ parentArn: undefined });

  await migrateExecutionRecord(newExecution, t.context.knex);
  await executionsModel.create(newExecution);
  t.teardown(() => executionsModel.delete({ arn: newExecution.arn }));

  const migrationSummary = await migrateExecutions(process.env, t.context.knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 1,
    skipped: 1,
    failed: 0,
    success: 0,
  });

  const records = await t.context.knex.queryBuilder().select().table('executions');
  t.is(records.length, 1);
});

test.serial('migrateExecutionRecord migrates parent execution if not already migrated', async (t) => {
  // This will be the child execution (no parent execution)
  const fakeExecution = fakeExecutionFactoryV2({ parentArn: undefined });
  const fakeExecution2 = fakeExecutionFactoryV2({ parentArn: fakeExecution.arn });

  const [
    parentExecution,
    childExecution,
  ] = await Promise.all([
    executionsModel.create(fakeExecution),
    executionsModel.create(fakeExecution2),
  ]);

  t.teardown(() => Promise.all([
    executionsModel.delete({ arn: fakeExecution.arn }),
    executionsModel.delete({ arn: fakeExecution2.arn }),
  ]));

  // explicitly migrate only the child. This should also find and migrate the parent
  await migrateExecutionRecord(childExecution, t.context.knex);

  const parentPgRecord = await t.context.knex.queryBuilder()
    .select()
    .table('executions')
    .where({ arn: parentExecution.arn })
    .first();

  const childPgRecord = await t.context.knex.queryBuilder()
    .select()
    .table('executions')
    .where({ arn: childExecution.arn })
    .first();

  // Check that the parent execution was correctly migrated to Postgres
  // Check that the original (child) execution was correctly migrated to Postgres
  // The child's parent_cumulus_id should also be set
  assertPgExecutionMatches(t, parentExecution, parentPgRecord);
  assertPgExecutionMatches(
    t,
    childExecution,
    childPgRecord,
    { parent_cumulus_id: parentPgRecord.cumulus_id }
  );
});

test.serial('migrateExecutionRecord recursively migrates grandparent executions', async (t) => {
  const fakeExecution = fakeExecutionFactoryV2({ parentArn: undefined });
  const fakeExecution2 = fakeExecutionFactoryV2({ parentArn: fakeExecution.arn });
  const fakeExecution3 = fakeExecutionFactoryV2({ parentArn: fakeExecution2.arn });

  const [
    grandparentExecution,
    parentExecution,
    childExecution,
  ] = await Promise.all([
    executionsModel.create(fakeExecution),
    executionsModel.create(fakeExecution2),
    executionsModel.create(fakeExecution3),
  ]);

  t.teardown(() => Promise.all([
    executionsModel.delete({ arn: fakeExecution.arn }),
    executionsModel.delete({ arn: fakeExecution2.arn }),
    executionsModel.delete({ arn: fakeExecution3.arn }),
  ]));

  // explicitly migrate only the child. This should also find and migrate the parent and grandparent
  await migrateExecutionRecord(childExecution, t.context.knex);

  const grandparentPgRecord = await t.context.knex.queryBuilder()
    .select()
    .table('executions')
    .where({ arn: grandparentExecution.arn })
    .first();

  const parentPgRecord = await t.context.knex.queryBuilder()
    .select()
    .table('executions')
    .where({ arn: parentExecution.arn })
    .first();

  const childPgRecord = await t.context.knex.queryBuilder()
    .select()
    .table('executions')
    .where({ arn: childExecution.arn })
    .first();

  // Check that the grandparent execution was correctly migrated to Postgres
  // Check that the original (child) and parent executions were correctly migrated to Postgres
  // The child's parent_cumulus_id should be the parent's cumulus_id and the
  // parent's parent_cumulus_id should be the grandparent's cumulus_id
  assertPgExecutionMatches(t, grandparentExecution, grandparentPgRecord);
  assertPgExecutionMatches(
    t,
    parentExecution,
    parentPgRecord,
    { parent_cumulus_id: grandparentPgRecord.cumulus_id }
  );
  assertPgExecutionMatches(
    t,
    childExecution,
    childPgRecord,
    { parent_cumulus_id: parentPgRecord.cumulus_id }
  );
});

test.serial('child execution migration fails if parent execution cannot be migrated', async (t) => {
  const parentExecution = fakeExecutionFactoryV2({ parentArn: undefined });
  const childExecution = fakeExecutionFactoryV2({ parentArn: parentExecution.arn });

  // make parent record invalid
  delete parentExecution.name;

  await Promise.all([
    // Have to use Dynamo client directly because creating
    // via model won't allow creation of an invalid record
    dynamodbDocClient().put({
      TableName: process.env.ExecutionsTable,
      Item: parentExecution,
    }).promise(),
    executionsModel.create(childExecution),
  ]);
  t.teardown(() => Promise.all([
    executionsModel.delete({ arn: parentExecution.arn }),
    executionsModel.delete({ arn: childExecution.arn }),
  ]));

  const migrationSummary = await migrateExecutions(process.env, t.context.knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 2,
    skipped: 0,
    failed: 2,
    success: 0,
  });
  const records = await t.context.knex.queryBuilder().select().table('executions');
  t.is(records.length, 0);
});

test.serial('migrateExecutions processes multiple executions', async (t) => {
  const newExecution = fakeExecutionFactoryV2({ parentArn: undefined });
  const newExecution2 = fakeExecutionFactoryV2({ parentArn: undefined });

  await Promise.all([
    executionsModel.create(newExecution),
    executionsModel.create(newExecution2),
  ]);
  t.teardown(() => Promise.all([
    executionsModel.delete({ arn: newExecution.arn }),
    executionsModel.delete({ arn: newExecution2.arn }),
  ]));

  const migrationSummary = await migrateExecutions(process.env, t.context.knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 2,
    skipped: 0,
    failed: 0,
    success: 2,
  });
  const records = await t.context.knex.queryBuilder().select().table('executions');
  t.is(records.length, 2);
});

test.serial('migrateExecutions processes all non-failing records', async (t) => {
  const newExecution = fakeExecutionFactoryV2({ parentArn: undefined });
  const newExecution2 = fakeExecutionFactoryV2({ parentArn: undefined });

  // remove required source field so that record will fail
  delete newExecution.name;

  await Promise.all([
    // Have to use Dynamo client directly because creating
    // via model won't allow creation of an invalid record
    dynamodbDocClient().put({
      TableName: process.env.ExecutionsTable,
      Item: newExecution,
    }).promise(),
    executionsModel.create(newExecution2),
  ]);
  t.teardown(() => Promise.all([
    executionsModel.delete({ arn: newExecution.arn }),
    executionsModel.delete({ arn: newExecution2.arn }),
  ]));
=======
test('migrateExecutionRecord skips already migrated record', async (t) => {
>>>>>>> 5c0fb5768... CUMULUS-2188 postgres model definition for executions with tests

  const migrationSummary = await migrateExecutions(process.env, t.context.knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 2,
    skipped: 0,
    failed: 1,
    success: 1,
  });
  const records = await t.context.knex.queryBuilder().select().table('executions');
  t.is(records.length, 1);
});
