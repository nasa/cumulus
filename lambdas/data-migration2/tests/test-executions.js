const omit = require('lodash/omit');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const uuid = require('uuid/v4');

const Execution = require('@cumulus/api/models/executions');
const AsyncOperation = require('@cumulus/api/models/async-operation');
const Collection = require('@cumulus/api/models/collections');

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
const { migrationDir } = require('../../db-migration');

const {
  migrateExecutionRecord,
} = require('../dist/lambda/executions');
// TODO should we not pull these from another Lambda?
const { migrateAsyncOperationRecord } = require('../../data-migration1/dist/lambda/async-operations');
const { migrateCollectionRecord } = require('../../data-migration1/dist/lambda/collections');

const executionOmitList = [
  'createdAt', 'updatedAt', 'finalPayload', 'originalPayload', 'parentArn', 'type', 'execution', 'name', 'collectionId', 'asyncOperationId',
];

const testDbName = `data_migration_2_${cryptoRandomString({ length: 10 })}`;
const testDbUser = 'postgres';

process.env.stackName = cryptoRandomString({ length: 10 });
process.env.system_bucket = cryptoRandomString({ length: 10 });
process.env.ExecutionsTable = cryptoRandomString({ length: 10 });
process.env.AsyncOperationsTable = cryptoRandomString({ length: 10 });
process.env.CollectionsTable = cryptoRandomString({ length: 10 });

const executionsModel = new Execution();
const asyncOperationsModel = new AsyncOperation({
  stackName: process.env.stackName,
  systemBucket: process.env.system_bucket,
});
const collectionsModel = new Collection();

test.before(async (t) => {
  await createBucket(process.env.system_bucket);
  await executionsModel.createTable();
  await asyncOperationsModel.createTable();
  await collectionsModel.createTable();

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

  // This will be the top-level execution (no parent execution)
  t.context.existingExecution = await executionsModel.create(fakeExecutionFactoryV2({ parentArn: undefined }));
  t.context.existingCollection = await collectionsModel.create(fakeCollectionFactory());
  t.context.existingAsyncOperation = await asyncOperationsModel.create(
    fakeAsyncOperationFactory({
      id: uuid(),
      output: '{ "output": "test" }',
    })
  );
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
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${testDbName}"`);
  await t.context.knexAdmin.destroy();
});

test.serial('migrateExecutionRecord correctly migrates execution record', async (t) => {
  const {
    existingExecution,
    existingCollection,
    existingAsyncOperation,
  } = t.context;

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
    // TODO double-check that this is right. The IDs here are always in this format?
    collectionId: `${existingCollection.name}___${existingCollection.version}`,
    asyncOperationId: existingAsyncOperation.id,
  });

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
        async_operation_cumulus_id: 1,
        collection_cumulus_id: 1,
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
        duration: null,
        error: null,
        parent_cumulus_id: null,
        workflow_name: newExecution.name,
        original_payload: null,
        final_payload: null,
        created_at: new Date(newExecution.createdAt),
        updated_at: new Date(newExecution.updatedAt),
        timestamp: null,
        tasks: null,
      },
      executionOmitList
    )
  );
});

test.serial('migrateExecutionRecord ignores extraneous fields from Dynamo', async (t) => {

});

test.serial('migrateExecutionRecord skips already migrated record', async (t) => {

});
