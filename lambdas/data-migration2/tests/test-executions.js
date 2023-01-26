const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');
const sinon = require('sinon');
const test = require('ava');

// Dynamo models
const Execution = require('@cumulus/api/models/executions');
const AsyncOperation = require('@cumulus/api/models/async-operation');
const Collection = require('@cumulus/api/models/collections');
const Rule = require('@cumulus/api/models/rules');
const Logger = require('@cumulus/logger');

// PG models
const { CollectionPgModel, AsyncOperationPgModel, ExecutionPgModel } = require('@cumulus/db');

const { RecordAlreadyMigrated } = require('@cumulus/errors');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const { fakeExecutionFactoryV2 } = require('@cumulus/api/lib/testUtils');
const {
  generateLocalTestDb,
  destroyLocalTestDb,
  migrationDir,
} = require('@cumulus/db');

const { constructCollectionId } = require('@cumulus/message/Collections');

// PG mock data factories
const {
  fakeCollectionRecordFactory,
  fakeAsyncOperationRecordFactory,
} = require('@cumulus/db/dist/test-utils');

const {
  createBucket,
  recursivelyDeleteS3Bucket,
  getJsonS3Object,
} = require('@cumulus/aws-client/S3');

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

  t.context.executionPgModel = new ExecutionPgModel();

  await executionsModel.createTable();
  await asyncOperationsModel.createTable();
  await collectionsModel.createTable();
  await rulesModel.createTable();

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;

  t.context.dynamodbDocClient = dynamodbDocClient({
    marshallOptions: {
      convertEmptyValues: true,
      removeUndefinedValues: true,
    },
  });
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
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test.serial('migrateExecutionRecord correctly migrates execution record', async (t) => {
  const { knex, executionPgModel } = t.context;

  // This will be the top-level execution (no parent execution)
  const fakeExecution = fakeExecutionFactoryV2({ parentArn: undefined });
  const fakeCollection = fakeCollectionRecordFactory();
  const fakeAsyncOperation = fakeAsyncOperationRecordFactory();
  const existingExecution = await executionsModel.create(fakeExecution);

  const collectionPgModel = new CollectionPgModel();
  const [pgCollection] = await collectionPgModel.create(
    t.context.knex,
    fakeCollection
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;

  const asyncOperationPgModel = new AsyncOperationPgModel();
  const [pgAsyncOperation] = await asyncOperationPgModel.create(
    t.context.knex,
    fakeAsyncOperation
  );

  t.teardown(() => Promise.all([
    executionsModel.delete({ arn: fakeExecution.arn }),
  ]));

  // migrate the existing dynamo execution to postgres so
  // we can use it as the parent for the next execution
  await migrateExecutionRecord(existingExecution, t.context.knex);

  const existingPostgresExecution = await executionPgModel.get(
    knex,
    { arn: existingExecution.arn }
  );

  // Create new Dynamo execution to be migrated to postgres
  const newExecution = fakeExecutionFactoryV2({
    parentArn: existingExecution.arn,
    collectionId: constructCollectionId(fakeCollection.name, fakeCollection.version),
    asyncOperationId: fakeAsyncOperation.id,
  });

  await migrateExecutionRecord(newExecution, t.context.knex);

  const createdRecord = await executionPgModel.get(
    knex,
    { arn: newExecution.arn }
  );

  assertPgExecutionMatches(t, newExecution, createdRecord, {
    async_operation_cumulus_id: pgAsyncOperation.cumulus_id,
    collection_cumulus_id: t.context.collectionCumulusId,
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
  const { knex, executionPgModel } = t.context;

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

  const createdRecord = await executionPgModel.get(
    knex,
    { arn: newExecution.arn }
  );

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

  const olderExecution = {
    ...newExecution,
    updatedAt: Date.now() - 1000,
  };

  await t.throwsAsync(
    migrateExecutionRecord(olderExecution, t.context.knex),
    { instanceOf: RecordAlreadyMigrated }
  );
});

test.serial('migrateExecutionRecord updates an already migrated record if the updated date is newer', async (t) => {
  const { knex, executionPgModel } = t.context;

  const fakeExecution = fakeExecutionFactoryV2({
    parentArn: undefined,
    updatedAt: Date.now() - 1000,
  });
  await migrateExecutionRecord(fakeExecution, t.context.knex);

  const newerFakeExecution = {
    ...fakeExecution,
    updatedAt: Date.now(),
  };
  await migrateExecutionRecord(newerFakeExecution, t.context.knex);

  const createdRecord = await executionPgModel.get(
    knex,
    { arn: fakeExecution.arn }
  );

  assertPgExecutionMatches(t, newerFakeExecution, createdRecord);
});

test.serial('migrateExecutions skips already migrated record', async (t) => {
  const { knex, executionPgModel } = t.context;

  const newExecution = fakeExecutionFactoryV2({ parentArn: undefined });

  await migrateExecutionRecord(newExecution, t.context.knex);
  await executionsModel.create(newExecution);
  t.teardown(() => executionsModel.delete({ arn: newExecution.arn }));

  const migrationSummary = await migrateExecutions(process.env, t.context.knex);
  t.deepEqual(migrationSummary, {
    total_dynamo_db_records: 1,
    skipped: 1,
    failed: 0,
    migrated: 0,
  });

  const records = await executionPgModel.search(
    knex,
    {}
  );
  t.is(records.length, 1);
});

test.serial('migrateExecutionRecord migrates parent execution if not already migrated', async (t) => {
  const { knex, executionPgModel } = t.context;

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

  const parentPgRecord = await executionPgModel.get(
    knex,
    { arn: parentExecution.arn }
  );

  const childPgRecord = await executionPgModel.get(
    knex,
    { arn: childExecution.arn }
  );

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
  const { knex, executionPgModel } = t.context;

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

  const grandparentPgRecord = await executionPgModel.get(
    knex,
    { arn: grandparentExecution.arn }
  );

  const parentPgRecord = await executionPgModel.get(
    knex,
    { arn: parentExecution.arn }
  );

  const childPgRecord = await executionPgModel.get(
    knex,
    { arn: childExecution.arn }
  );

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
  const { knex, executionPgModel } = t.context;

  const parentExecution = fakeExecutionFactoryV2({
    parentArn: undefined,
    // make parent record reference to non-existent async operation
    // so that it fails to migrate
    asyncOperationId: cryptoRandomString({ length: 5 }),
  });
  const childExecution = fakeExecutionFactoryV2({ parentArn: parentExecution.arn });

  await Promise.all([
    // Have to use Dynamo client directly because creating
    // via model won't allow creation of an invalid record
    t.context.dynamodbDocClient.put({
      TableName: process.env.ExecutionsTable,
      Item: parentExecution,
    }),
    executionsModel.create(childExecution),
  ]);
  t.teardown(() => Promise.all([
    executionsModel.delete({ arn: parentExecution.arn }),
    executionsModel.delete({ arn: childExecution.arn }),
  ]));

  const migrationSummary = await migrateExecutions(process.env, t.context.knex);
  t.deepEqual(migrationSummary, {
    total_dynamo_db_records: 2,
    skipped: 0,
    failed: 2,
    migrated: 0,
  });
  const records = await executionPgModel.search(
    knex,
    {}
  );
  t.is(records.length, 0);
});

test.serial('migrateExecutions processes multiple executions', async (t) => {
  const { knex, executionPgModel } = t.context;

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

  const migrationSummary = await migrateExecutions(
    process.env,
    t.context.knex,
    {
      parallelScanLimit: 1,
      parallelScanSegments: 2,
    }
  );
  t.deepEqual(migrationSummary, {
    total_dynamo_db_records: 2,
    skipped: 0,
    failed: 0,
    migrated: 2,
  });
  const records = await executionPgModel.search(
    knex,
    {}
  );
  t.is(records.length, 2);
});

test.serial('migrateExecutions processes all non-failing records', async (t) => {
  const { knex, executionPgModel } = t.context;

  const newExecution = fakeExecutionFactoryV2({ parentArn: undefined });
  const newExecution2 = fakeExecutionFactoryV2({
    parentArn: undefined,
    // reference non-existent async operation so migration fails
    asyncOperationId: cryptoRandomString({ length: 5 }),
  });

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
    total_dynamo_db_records: 2,
    skipped: 0,
    failed: 1,
    migrated: 1,
  });
  const records = await executionPgModel.search(
    knex,
    {}
  );
  t.is(records.length, 1);
});

test.serial('migrateExecutions logs summary of migration for a specified loggingInterval', async (t) => {
  const logSpy = sinon.spy(Logger.prototype, 'info');

  const execution = fakeExecutionFactoryV2({ parentArn: undefined });
  await executionsModel.create(execution);
  const execution2 = fakeExecutionFactoryV2({ parentArn: undefined });
  await executionsModel.create(execution2);

  t.teardown(async () => {
    logSpy.restore();
    await executionsModel.delete({ arn: execution.arn });
    await executionsModel.delete({ arn: execution2.arn });
  });

  await migrateExecutions(
    process.env,
    t.context.knex,
    {
      loggingInterval: 1,
      parallelScanLimit: 1,
      parallelScanSegments: 2,
    }
  );
  t.true(logSpy.calledWith('Batch of 1 execution records processed, 1 total'));
  t.true(logSpy.calledWith('Batch of 1 execution records processed, 2 total'));
});

test.serial('migrateExecutions writes errors to S3 object', async (t) => {
  const key = `${process.env.stackName}/data-migration2-executions-errors-123.json`;

  const execution1 = fakeExecutionFactoryV2({
    asyncOperationId: undefined,
  });
  const execution2 = fakeExecutionFactoryV2({
    asyncOperationId: undefined,
  });

  await Promise.all([
    executionsModel.create(execution1),
    executionsModel.create(execution2),
  ]);
  t.teardown(() => Promise.all([
    executionsModel.delete({ arn: execution1.arn }),
    executionsModel.delete({ arn: execution2.arn }),
  ]));

  await migrateExecutions(process.env, t.context.knex, {}, '123');

  // Check that error file exists in S3
  const errorReportJson = await getJsonS3Object(
    process.env.system_bucket,
    key
  );
  const { errors } = errorReportJson;
  const expectedResult = /RecordDoesNotExist/;

  t.is(errors.length, 2);
  t.true(expectedResult.test(errors[0]));
  t.true(expectedResult.test(errors[1]));
});

test.serial('migrateExecutions correctly delimits errors written to S3 object', async (t) => {
  const key = `${process.env.stackName}/data-migration2-executions-errors-123.json`;

  const execution1 = fakeExecutionFactoryV2({
    parentArn: undefined,
  });
  const execution2 = fakeExecutionFactoryV2({
    asyncOperationId: undefined,
  });
  const execution3 = fakeExecutionFactoryV2({
    asyncOperationId: undefined,
  });

  await Promise.all([
    executionsModel.create(execution1),
    executionsModel.create(execution2),
    executionsModel.create(execution3),
  ]);

  // Prematurely migrate execution, will be skipped and excluded from error file
  await migrateExecutionRecord(execution1, t.context.knex);

  t.teardown(() => Promise.all([
    executionsModel.delete({ arn: execution1.arn }),
    executionsModel.delete({ arn: execution2.arn }),
    executionsModel.delete({ arn: execution3.arn }),
  ]));

  await migrateExecutions(process.env, t.context.knex, {}, '123');

  // Check that error file exists in S3
  const errorReportJson = await getJsonS3Object(
    process.env.system_bucket,
    key
  );
  const { errors } = errorReportJson;
  const expectedResult = /RecordDoesNotExist/;

  t.is(errors.length, 2);
  t.true(expectedResult.test(errors[0]));
  t.true(expectedResult.test(errors[1]));
});
