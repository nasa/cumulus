const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  CollectionPgModel,
  ExecutionPgModel,
  GranulePgModel,
  generateLocalTestDb,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeGranuleRecordFactory,
} = require('../../dist');

const { migrationDir } = require('../../../../lambdas/db-migration');

const testDbName = `granule_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.granulePgModel = new GranulePgModel();

  const collectionPgModel = new CollectionPgModel();
  t.context.collection = fakeCollectionRecordFactory();
  const collectionResponse = await collectionPgModel.create(
    t.context.knex,
    t.context.collection
  );
  t.context.collectionCumulusId = collectionResponse[0];

  t.context.executionPgModel = new ExecutionPgModel();
  const [executionCumulusId] = await t.context.executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory()
  );
  t.context.executionCumulusId = executionCumulusId;
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
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
    status: 'running',
  });

  await granulePgModel.upsert(knex, granule);

  t.like(
    await granulePgModel.get(knex, granule),
    granule
  );
});

test('GranulePgModel.upsert() will overwrite allowed fields of a running granule for a different execution', async (t) => {
  const {
    knex,
    executionPgModel,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'running',
    collection_cumulus_id: collectionCumulusId,
    execution_cumulus_id: executionCumulusId,
  });

  await granulePgModel.create(knex, granule);

  const [newExecutionCumulusId] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'running' })
  );

  const updatedGranule = {
    ...granule,
    execution_cumulus_id: newExecutionCumulusId,
    timestamp: new Date(),
    updated_at: new Date(),
  };

  await granulePgModel.upsert(knex, updatedGranule);

  t.like(
    await granulePgModel.get(knex, { granule_id: granule.granule_id }),
    updatedGranule
  );
});

test('GranulePgModel.upsert() creates a new completed granule', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'completed',
    collection_cumulus_id: collectionCumulusId,
    execution_cumulus_id: executionCumulusId,
  });

  await granulePgModel.upsert(knex, granule);

  t.like(
    await granulePgModel.get(knex, granule),
    granule
  );
});

test('GranulePgModel.upsert() overwrites a completed granule', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'completed',
    product_volume: 50,
    collection_cumulus_id: collectionCumulusId,
    execution_cumulus_id: executionCumulusId,
  });

  await granulePgModel.create(knex, granule);

  const updatedGranule = {
    ...granule,
    product_volume: 100,
  };

  await granulePgModel.upsert(knex, updatedGranule);

  t.like(
    await granulePgModel.get(knex, { granule_id: granule.granule_id }),
    {
      ...updatedGranule,
      product_volume: '100',
    }
  );
});

test('GranulePgModel.upsert() will allow a completed status to replace a running status for same execution', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'running',
    collection_cumulus_id: collectionCumulusId,
    execution_cumulus_id: executionCumulusId,
  });

  await granulePgModel.create(knex, granule);

  const updatedGranule = {
    ...granule,
    status: 'completed',
  };

  await granulePgModel.upsert(knex, updatedGranule);

  t.like(
    await granulePgModel.get(knex, { granule_id: granule.granule_id }),
    updatedGranule
  );
});

test('GranulePgModel.upsert() will not allow a running status to replace a completed status for same execution', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'completed',
    collection_cumulus_id: collectionCumulusId,
    execution_cumulus_id: executionCumulusId,
  });

  await granulePgModel.create(knex, granule);

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await granulePgModel.upsert(knex, updatedGranule);

  const record = await granulePgModel.get(knex, { granule_id: granule.granule_id });
  t.is(record.status, 'completed');
});

test('GranulePgModel.upsert() will allow a running status to replace a completed status for different execution', async (t) => {
  const {
    knex,
    executionPgModel,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'completed',
    collection_cumulus_id: collectionCumulusId,
    execution_cumulus_id: executionCumulusId,
  });

  await granulePgModel.create(knex, granule);

  const [newExecutionCumulusId] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'running' })
  );

  const updatedGranule = {
    ...granule,
    status: 'running',
    execution_cumulus_id: newExecutionCumulusId,
  };

  await granulePgModel.upsert(knex, updatedGranule);

  const record = await granulePgModel.get(knex, { granule_id: granule.granule_id });
  t.is(record.status, 'running');
});

test('GranulePgModel.delete() deletes an unpublished granule', async (t) => {});

test('GranulePgModel.delete() throws an error if the granule is published', async (t) => {});

test('GranulePgModel.delete() works with a transaction', async (t) => {});
