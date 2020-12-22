const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  localStackConnectionEnv,
  getKnexClient,
  CollectionPgModel,
  ExecutionPgModel,
  PdrPgModel,
  ProviderPgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeProviderRecordFactory,
  fakePdrRecordFactory,
  tableNames,
} = require('../../dist');

const { migrationDir } = require('../../../../lambdas/db-migration');

const testDbName = `pdr_${cryptoRandomString({ length: 10 })}`;
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

  t.context.pdrPgModel = new PdrPgModel();

  const collectionPgModel = new CollectionPgModel();
  const [collectionCumulusId] = await collectionPgModel.create(
    t.context.knex,
    fakeCollectionRecordFactory()
  );
  t.context.collectionCumulusId = collectionCumulusId;

  const executionPgModel = new ExecutionPgModel();
  const [executionCumulusId] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory()
  );
  t.context.executionCumulusId = executionCumulusId;

  const providerPgModel = new ProviderPgModel();
  const [providerCumulusId] = await providerPgModel.create(
    t.context.knex,
    fakeProviderRecordFactory()
  );
  t.context.providerCumulusId = providerCumulusId;
});

test.beforeEach((t) => {
  t.context.pdrRecord = fakePdrRecordFactory({
    collection_cumulus_id: t.context.collectionCumulusId,
    execution_cumulus_id: t.context.executionCumulusId,
    provider_cumulus_id: t.context.providerCumulusId,
  });
});

test.after.always(async (t) => {
  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${testDbName}"`);
  await t.context.knexAdmin.destroy();
});

test('PdrPgModel.upsert() does not update record with same execution if progress is less than current', async (t) => {
  const {
    knex,
    pdrPgModel,
    pdrRecord,
  } = t.context;

  pdrRecord.status = 'running';
  pdrRecord.progress = 75;
  const [insertResult] = await knex(tableNames.pdrs)
    .insert(pdrRecord)
    .returning('*');
  t.is(insertResult.progress, 75);

  // Update PDR progress
  const updatedRecord = {
    ...pdrRecord,
    progress: 50,
  };

  await pdrPgModel.upsert(knex, updatedRecord);

  t.like(
    await pdrPgModel.get(knex, { name: pdrRecord.name }),
    pdrRecord
  );
});
