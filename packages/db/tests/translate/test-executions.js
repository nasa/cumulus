const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
<<<<<<< HEAD

const { removeNilProperties } = require('@cumulus/common/util');
const { translateApiExecutionToPostgresExecution } = require('../../dist/translate/executions');

test('translateApiExecutionToPostgresExecution converts API execution to Postgres', async (t) => {
=======
const Execution = require('@cumulus/api/models/executions');

const { removeNilProperties } = require('@cumulus/common/util');
<<<<<<<< HEAD:packages/db/tests/translate/test-executions.js
const { translateApiExecutionToPostgresExecution } = require('../../dist/translate/executions');
========
const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');
const { translateApiExecutionToPostgresExecution } = require('../dist/executions');
>>>>>>>> 066082f0e... CUMULUS-2188 address PR comments:packages/db/tests/test-executions.js

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');

const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');

const testDbName = `data_migration_2_${cryptoRandomString({ length: 10 })}`;
const testDbUser = 'postgres';

test.before(async (t) => {
  process.env.stackName = cryptoRandomString({ length: 10 });
  process.env.system_bucket = cryptoRandomString({ length: 10 });
  process.env.ExecutionsTable = cryptoRandomString({ length: 10 });

  await createBucket(process.env.system_bucket);
  executionsModel = new Execution();
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
});

test('translateApiExecutionToPostgresExecution converts API execution to Postgres', (t) => {
>>>>>>> 066082f0e... CUMULUS-2188 address PR comments
  const now = Date.now();

  const apiExecution = {
    arn: 'arn:aws:lambda:us-east-1:1234:1234',
    name: `${cryptoRandomString({ length: 10 })}execution`,
    execution: 'https://test',
<<<<<<< HEAD
    error: { test: 'error' },
    tasks: {},
=======
    error: {}, //TODO find example
    tasks: {}, //TODO find example
>>>>>>> 066082f0e... CUMULUS-2188 address PR comments
    type: 'IngestGranule',
    status: 'running',
    createdAt: now,
    updatedAt: now,
    timestamp: now,
<<<<<<< HEAD
    originalPayload: { testInput: 'originalPayloadValue' },
    finalPayload: { testOutput: 'finalPayloadValue' },
    duration: 2,
    cumulusVersion: '1.0.0',
    collectionId: 'name___version',
    asyncOperationId: '1234',
    parentArn: 'arn:aws:lambda:us-east-1:5678:5678',
  };

  const collectionCumulusId = 1;
  const asyncOperationCumulusId = 2;
  const executionCumulusId = 3;

  const fakeDbClient = {};

  const fakeCollectionPgModel = {
    getRecordCumulusId: async () => collectionCumulusId,
  };
  const fakeAsyncOperationPgModel = {
    getRecordCumulusId: async () => asyncOperationCumulusId,
  };
  const fakeExecutionPgModel = {
    getRecordCumulusId: async () => executionCumulusId,
  };

  const expectedPostgresExecution = {
    status: apiExecution.status,
    tasks: apiExecution.tasks,
    error: apiExecution.error,
    arn: apiExecution.arn,
    duration: apiExecution.duration,
    original_payload: apiExecution.originalPayload,
    final_payload: apiExecution.finalPayload,
    workflow_name: apiExecution.type,
    timestamp: new Date(apiExecution.timestamp),
    created_at: new Date(apiExecution.createdAt),
    updated_at: new Date(apiExecution.updatedAt),
    url: apiExecution.execution,
    cumulus_version: apiExecution.cumulusVersion,
    async_operation_cumulus_id: asyncOperationCumulusId,
    collection_cumulus_id: collectionCumulusId,
    parent_cumulus_id: executionCumulusId,
  };

  const result = removeNilProperties(
    await translateApiExecutionToPostgresExecution(
      apiExecution,
      fakeDbClient,
      fakeCollectionPgModel,
      fakeAsyncOperationPgModel,
      fakeExecutionPgModel
    )
  );

  t.deepEqual(
    result,
=======
    originalPayload: {}, //TODO find example
    finalPayload: {}, //TODO find example
    collectionId: '1',
    duration: 2,
    parentArn: 'arn:aws:lambda:us-east-1:1234:1234', // TODO create execution with this arn
    asyncOperationId: '1',
  };

  const expectedPostgresExecution = {
    async_operation_cumulus_id: Number(apiExecution.asyncOperationId),
    collection_cumulus_id: Number(apiExecution.collectionId),
    status: apiExecution.status,
    tasks: JSON.stringify(apiExecution.tasks),
    error: JSON.stringify(apiExecution.error),
    arn: apiExecution.arn,
    duration: apiExecution.duration,
    original_payload: JSON.stringify(apiExecution.originalPayload),
    final_payload: JSON.stringify(apiExecution.finalPayload),
    timestamp: new Date(apiExecution.timestamp),
    created_at: new Date(apiExecution.createdAt),
    updated_at: new Date(apiExecution.updatedAt),
  };

  t.deepEqual(
    removeNilProperties(translateApiExecutionToPostgresExecution(apiExecution)),
>>>>>>> 066082f0e... CUMULUS-2188 address PR comments
    expectedPostgresExecution
  );
});
