const omit = require('lodash/omit');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const Execution = require('@cumulus/api/models/executions');
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

const testDbName = `data_migration_2_${cryptoRandomString({ length: 10 })}`;
const testDbUser = 'postgres';

// An Execution Dynamo record
const generateFakeDynamoExecution = (params) => ({
  arn: 'arn:aws:lambda:us-east-1:1234:1234',
  name: `${cryptoRandomString({ length: 10 })}execution`,
  execution: 'https://test',
  error: {},
  tasks: {},
  type: 'IngestGranule',
  status: 'running',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  timestamp: Date.now(),
  originalPayload: {},
  finalPayload: undefined,
  collectionId: '1',
  duration: 2,
  parentArn: 'arn:aws:lambda:us-east-1:1234:1234',
  asyncOperationId: '1',
  ...params,
});

let executionsModel;

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
  const dynamoExecution = generateFakeDynamoExecution({});

  await migrateExecutionRecord(dynamoExecution, t.context.knex);
  const createdRecord = await t.context.knex.queryBuilder()
    .select()
    .table('executions')
    .where({ arn: dynamoExecution.arn })
    .first();

  t.deepEqual(
    omit(createdRecord, ['cumulus_id']),
    { ...dynamoExecution }
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
