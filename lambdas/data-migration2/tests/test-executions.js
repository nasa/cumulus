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

const { fakeExecutionFactoryV2 } = require('@cumulus/api/lib/testUtils');

const testDbName = `data_migration_2_${cryptoRandomString({ length: 10 })}`;
const testDbUser = 'postgres';

async function addFakeData(numItems, factory, model, factoryParams = {}) {
  const items = [];

  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < numItems; i += 1) {
    const item = factory(factoryParams);
    items.push(item);
    await model.create(item);
  }
  /* eslint-enable no-await-in-loop */

  return items;
}

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

  // await addFakeData(1, fakeExecutionFactoryV2, executionsModel);
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

test.only('migrateExecutionRecord correctly migrates execution record', async (t) => {
  const { existingExecution } = t.context;

  const existingRecord = await executionsModel.get();

  console.log(existingRecord);

  // Create new Dynamo execution to be migrated
  const newExecution = fakeExecutionFactoryV2({ parentArn: existingExecution.arn });

  await migrateExecutionRecord(newExecution, t.context.knex);
  // const createdRecord = await t.context.knex.queryBuilder()
  //   .select()
  //   .table('executions')
  //   .where({ cumulus_id: newExecution.cumulus_id })
  //   .first();

  // t.deepEqual(
  //   omit(createdRecord, ['cumulus_id']),
  //   { ...newExecution }
  // );
});

test('migrateExecutionRecord throws error on invalid source data from Dynamo', async (t) => {

});

test('migrateExecutionRecord handles nullable fields on source execution data', async (t) => {

});

test('migrateExecutionRecord ignores extraneous fields from Dynamo', async (t) => {

});

test('migrateExecutionRecord skips already migrated record', async (t) => {

});
