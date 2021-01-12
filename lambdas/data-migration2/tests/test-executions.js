const omit = require('lodash/omit');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const uuid = require('uuid/v4');

const Execution = require('@cumulus/api/models/executions');
const AsyncOperation = require('@cumulus/api/models/async-operation');
const Collection = require('@cumulus/api/models/collections');
const Rule = require('@cumulus/api/models/rules');

const { RecordAlreadyMigrated } = require('@cumulus/errors');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const {
  fakeExecutionFactoryV2,
  fakeCollectionFactory,
  fakeAsyncOperationFactory,
} = require('@cumulus/api/lib/testUtils');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');

// eslint-disable-next-line node/no-unpublished-require
const { migrateAsyncOperationRecord } = require('@cumulus/data-migration1/dist/lambda/async-operations');
// eslint-disable-next-line node/no-unpublished-require
const { migrateCollectionRecord } = require('@cumulus/data-migration1/dist/lambda/collections');

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');

const {
  migrateExecutionRecord,
  migrateExecutions,
} = require('../dist/lambda/executions');

let collectionsModel;
let executionsModel;
let asyncOperationsModel;
let rulesModel;

const executionOmitList = [
  'createdAt', 'updatedAt', 'finalPayload', 'originalPayload', 'parentArn', 'type', 'execution', 'name', 'collectionId', 'asyncOperationId', 'cumulusVersion',
];

const testDbName = `data_migration_2_${cryptoRandomString({ length: 10 })}`;
const testDbUser = 'postgres';

const assertPgExecutionMatches = (t, dynamoExecution, pgExecution, overrides = {}) => {
  t.deepEqual(
    omit(pgExecution, ['cumulus_id']),
    omit(
      {
        ...dynamoExecution,
        async_operation_cumulus_id: null,
        collection_cumulus_id: null,
        parent_cumulus_id: null,
        cumulus_version: dynamoExecution.cumulusVersion,
        url: dynamoExecution.execution,
        workflow_name: dynamoExecution.type,
        original_payload: dynamoExecution.originalPayload,
        final_payload: dynamoExecution.finalPayload,
        created_at: new Date(dynamoExecution.createdAt),
        updated_at: new Date(dynamoExecution.updatedAt),
        timestamp: new Date(dynamoExecution.timestamp),
        ...overrides,
      },
      executionOmitList
    )
  );
};

test.before(async (t) => {
  process.env.stackName = cryptoRandomString({ length: 10 });
  process.env.system_bucket = cryptoRandomString({ length: 10 });
  process.env.ExecutionsTable = cryptoRandomString({ length: 10 });
  process.env.AsyncOperationsTable = cryptoRandomString({ length: 10 });
  process.env.CollectionsTable = cryptoRandomString({ length: 10 });
  process.env.RulesTable = cryptoRandomString({ length: 10 });

  await createBucket(process.env.system_bucket);

  executionsModel = new Execution();
  asyncOperationsModel = new AsyncOperation({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
  });
  collectionsModel = new Collection();
  rulesModel = new Rule();

  await executionsModel.createTable();
  await asyncOperationsModel.createTable();
  await collectionsModel.createTable();
  await rulesModel.createTable();

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
  await t.context.knex('executions').del();
  await t.context.knex('collections').del();
  await t.context.knex('async_operations').del();
});

test.after.always(async (t) => {
  await executionsModel.deleteTable();
  await asyncOperationsModel.deleteTable();
  await collectionsModel.deleteTable();
  await rulesModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${testDbName}"`);
  await t.context.knexAdmin.destroy();
});

test.serial('migrateExecutionRecord correctly migrates execution record', async (t) => {
  // This will be the top-level execution (no parent execution)
  const fakeExecution = fakeExecutionFactoryV2({ parentArn: undefined });
  const fakeCollection = fakeCollectionFactory();
  const fakeAsyncOperation = fakeAsyncOperationFactory({
    id: uuid(),
    output: '{ "output": "test" }',
  });

  const [
    existingExecution,
    existingCollection,
    existingAsyncOperation,
  ] = await Promise.all([
    executionsModel.create(fakeExecution),
    collectionsModel.create(fakeCollection),
    asyncOperationsModel.create(fakeAsyncOperation),
  ]);

  t.teardown(() => Promise.all([
    executionsModel.delete({ arn: fakeExecution.arn }),
    collectionsModel.delete(fakeCollection),
    asyncOperationsModel.delete({ id: fakeAsyncOperation.id }),
  ]));

  // migrate existing async operation and collection
  await migrateAsyncOperationRecord(existingAsyncOperation, t.context.knex);
  await migrateCollectionRecord(existingCollection, t.context.knex);

  // migrate the existing dynamo execution to postgres so
  // we can use it as the parent for the next execution
  await migrateExecutionRecord(existingExecution, t.context.knex);

  const existingPostgresExecution = await t.context.knex.queryBuilder()
    .select()
    .table('executions')
    .where({ arn: existingExecution.arn })
    .first();

  // Create new Dynamo execution to be migrated to postgres
  const newExecution = fakeExecutionFactoryV2({
    parentArn: existingExecution.arn,
    collectionId: `${existingCollection.name}___${existingCollection.version}`,
    asyncOperationId: existingAsyncOperation.id,
  });

  await migrateExecutionRecord(newExecution, t.context.knex);

  const createdRecord = await t.context.knex.queryBuilder()
    .select()
    .table('executions')
    .where({ arn: newExecution.arn })
    .first();

  assertPgExecutionMatches(t, newExecution, createdRecord, {
    async_operation_cumulus_id: 1,
    collection_cumulus_id: 1,
    parent_cumulus_id: existingPostgresExecution.cumulus_id,
  });
});

test.serial('migrateExecutionRecord throws error on invalid source data from Dynamo', async (t) => {
  const newExecution = fakeExecutionFactoryV2();

  // make source record invalid
  delete newExecution.arn;

  await t.throwsAsync(migrateExecutionRecord(newExecution, t.context.knex));
});

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

test.serial('migrateExecutionRecord throws RecordAlreadyMigrated error for already migrated record', async (t) => {
  const newExecution = fakeExecutionFactoryV2({ parentArn: undefined });

  await migrateExecutionRecord(newExecution, t.context.knex);
  await t.throwsAsync(
    migrateExecutionRecord(newExecution, t.context.knex),
    { instanceOf: RecordAlreadyMigrated }
  );
});

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
