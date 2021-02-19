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
  t.context.granulesExecutionsPgModel = new GranulesExecutionsPgModel();

  const collectionPgModel = new CollectionPgModel();
  t.context.collection = fakeCollectionRecordFactory();
  const collectionResponse = await collectionPgModel.create(
    t.context.knex,
    t.context.collection
  );
  t.context.collectionCumulusId = collectionResponse[0];

  t.context.executionPgModel = new ExecutionPgModel();
});

test.beforeEach(async (t) => {
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

test('GranulePgModel.createWithExecutionHistory() creates a new granule with execution history', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
    granulesExecutionsPgModel,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'running',
  });

  const [granuleCumulusId] = await granulePgModel.createWithExecutionHistory(
    knex,
    granule,
    executionCumulusId
  );

  const granuleRecord = await granulePgModel.get(
    knex,
    granule
  );

  t.like(
    granuleRecord,
    {
      ...granule,
      cumulus_id: granuleCumulusId,
    }
  );
  t.deepEqual(
    await granulesExecutionsPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ),
    [{
      granule_cumulus_id: Number(granuleCumulusId),
      execution_cumulus_id: executionCumulusId,
    }]
  );
});

test('GranulePgModel.createWithExecutionHistory() works with a transaction', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
    granulesExecutionsPgModel,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'running',
  });

  const [granuleCumulusId] = await knex.transaction(
    (trx) =>
      granulePgModel.createWithExecutionHistory(
        trx,
        granule,
        executionCumulusId
      )
  );

  const granuleRecord = await granulePgModel.get(
    knex,
    granule
  );

  t.like(
    granuleRecord,
    {
      ...granule,
      cumulus_id: granuleCumulusId,
    }
  );
  t.deepEqual(
    await granulesExecutionsPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ),
    [{
      granule_cumulus_id: Number(granuleCumulusId),
      execution_cumulus_id: executionCumulusId,
    }]
  );
});

test('GranulePgModel.createWithExecutionHistory() when using a transaction does not commit granule or execution history if execution history write fails', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
    granulesExecutionsPgModel,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'running',
  });

  const fakeGranulesExecutionsPgModel = {
    create: async () => {
      throw new Error('error');
    },
  };

  await t.throwsAsync(
    knex.transaction(
      (trx) =>
        granulePgModel.createWithExecutionHistory(
          trx,
          granule,
          executionCumulusId,
          fakeGranulesExecutionsPgModel
        )
    )
  );

  t.false(
    await granulePgModel.exists(
      knex,
      {
        granule_id: granule.granule_id,
        collection_cumulus_id: collectionCumulusId,
      }
    )
  );
  t.false(
    await granulesExecutionsPgModel.exists(
      knex,
      {
        execution_cumulus_id: executionCumulusId,
      }
    )
  );
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
    status: 'running',
  });

  await granulePgModel.upsert(knex, granule, executionCumulusId);

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
  });

  await granulePgModel.createWithExecutionHistory(knex, granule, executionCumulusId);

  const [newExecutionCumulusId] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'running' })
  );

  const updatedGranule = {
    ...granule,
    timestamp: new Date(),
    updated_at: new Date(),
  };

  await granulePgModel.upsert(knex, updatedGranule, newExecutionCumulusId);

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
  });

  await granulePgModel.upsert(knex, granule, executionCumulusId);

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
  });

  await granulePgModel.createWithExecutionHistory(knex, granule, executionCumulusId);

  const updatedGranule = {
    ...granule,
    product_volume: 100,
  };

  await granulePgModel.upsert(knex, updatedGranule, executionCumulusId);

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
  });

  await granulePgModel.createWithExecutionHistory(knex, granule, executionCumulusId);

  const updatedGranule = {
    ...granule,
    status: 'completed',
  };

  await granulePgModel.upsert(knex, updatedGranule, executionCumulusId);

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
  });

  await granulePgModel.createWithExecutionHistory(knex, granule, executionCumulusId);

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await granulePgModel.upsert(knex, updatedGranule, executionCumulusId);

  const record = await granulePgModel.get(knex, { granule_id: granule.granule_id });
  t.is(record.status, 'completed');
});

test('GranulePgModel.upsert() will allow a running status to replace a non-running status for different execution', async (t) => {
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
  });

  await granulePgModel.createWithExecutionHistory(knex, granule, executionCumulusId);

  const [newExecutionCumulusId] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'running' })
  );

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await granulePgModel.upsert(knex, updatedGranule, newExecutionCumulusId);

  const record = await granulePgModel.get(knex, { granule_id: granule.granule_id });
  t.is(record.status, 'running');
});
