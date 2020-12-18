const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  localStackConnectionEnv,
  getKnexClient,
  CollectionPgModel,
  ExecutionPgModel,
  GranulePgModel,
} = require('../../dist');
const {
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
} = require('../../dist/test-utils');

const { migrationDir } = require('../../../../lambdas/db-migration');

const testDbName = `granule_${cryptoRandomString({ length: 10 })}`;
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

  t.context.granulePgModel = new GranulePgModel();

  const collectionPgModel = new CollectionPgModel();
  t.context.collection = fakeCollectionRecordFactory();
  const collectionResponse = await collectionPgModel.create(
    t.context.knex,
    t.context.collection
  );
  t.context.collectionCumulusId = collectionResponse[0];

  const executionPgModel = new ExecutionPgModel();
  const executionResponse = await executionPgModel.create(
    t.context.knex,
    {
      arn: cryptoRandomString({ length: 3 }),
      status: 'running',
    }
  );
  t.context.executionCumulusId = executionResponse[0];
});

test.after.always(async (t) => {
  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${testDbName}"`);
  await t.context.knexAdmin.destroy();
});

test('GranulePgModel.upsert() creates a new running granule', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    execution_cumulus_id: executionCumulusId,
  });

  await granulePgModel.upsert(knex, granule);

  t.like(
    await granulePgModel.get(knex, granule),
    granule
  );
});
