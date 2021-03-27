const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  CollectionPgModel,
  destroyLocalTestDb,
  ExecutionPgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeFileRecordFactory,
  fakeGranuleRecordFactory,
  generateLocalTestDb,
  FilePgModel,
  GranulePgModel,
  GranulesExecutionsPgModel,
  upsertGranuleWithExecutionJoinRecord,
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
  [t.context.collectionCumulusId] = await collectionPgModel.create(
    t.context.knex,
    t.context.collection
  );

  t.context.executionPgModel = new ExecutionPgModel();
});

test.beforeEach(async (t) => {
  [t.context.executionCumulusId] = await t.context.executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory()
  );
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

  await upsertGranuleWithExecutionJoinRecord(knex, granule, executionCumulusId);

  const [newExecutionCumulusId] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'running' })
  );

  const updatedGranule = {
    ...granule,
    timestamp: new Date(Date.now() + 1000),
    updated_at: new Date(Date.now() + 1000),
    created_at: new Date(Date.now() + 1000),
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

  await upsertGranuleWithExecutionJoinRecord(knex, granule, executionCumulusId);

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

  await upsertGranuleWithExecutionJoinRecord(knex, granule, executionCumulusId);

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

  await upsertGranuleWithExecutionJoinRecord(knex, granule, executionCumulusId);

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

  await upsertGranuleWithExecutionJoinRecord(knex, granule, executionCumulusId);

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

test('GranulePgModel.upsert() will not allow a final state from an older execution to overwrite the completed state from a newer execution', async (t) => {
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

  await upsertGranuleWithExecutionJoinRecord(knex, granule, executionCumulusId);

  const [newExecutionCumulusId] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'completed' })
  );

  const updatedGranule = {
    ...granule,
    status: 'failed',
    created_at: new Date(Date.now() - 100000),
  };

  await granulePgModel.upsert(knex, updatedGranule, newExecutionCumulusId);

  const record = await granulePgModel.get(knex, { granule_id: granule.granule_id });
  t.is(record.status, 'completed');
});

test('GranulePgModel.upsert() will not allow a running state from an older execution to overwrite the completed state from a newer execution', async (t) => {
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

  await upsertGranuleWithExecutionJoinRecord(knex, granule, executionCumulusId);

  const [newExecutionCumulusId] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'failed' })
  );

  const updatedGranule = {
    ...granule,
    status: 'running',
    created_at: new Date(Date.now() - 100000),
  };

  await granulePgModel.upsert(knex, updatedGranule, newExecutionCumulusId);

  const record = await granulePgModel.get(knex, { granule_id: granule.granule_id });
  t.is(record.status, 'completed');
});

test('GranulePgModel.upsert() succeeds without an execution', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'completed',
    collection_cumulus_id: collectionCumulusId,
  });

  await granulePgModel.upsert(knex, granule);
  t.true(await granulePgModel.exists(knex, granule));
});

test('GranulePgModel.delete() deletes granule and granule/execution join records', async (t) => {
  const {
    knex,
    granulesExecutionsPgModel,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'running',
    collection_cumulus_id: collectionCumulusId,
  });

  const granuleCumulusId = await knex.transaction(async (trx) => {
    const [innerGranuleCumulusId] = await granulePgModel.create(trx, granule);
    await granulesExecutionsPgModel.create(trx, {
      execution_cumulus_id: executionCumulusId,
      granule_cumulus_id: innerGranuleCumulusId,
    });
    return innerGranuleCumulusId;
  });

  t.true(
    await granulePgModel.exists(
      knex,
      {
        granule_id: granule.granule_id,
        collection_cumulus_id: collectionCumulusId,
      }
    )
  );
  t.true(
    await granulesExecutionsPgModel.exists(
      knex,
      {
        granule_cumulus_id: granuleCumulusId,
        execution_cumulus_id: executionCumulusId,
      }
    )
  );

  await knex.transaction(
    (trx) => granulePgModel.delete(
      trx,
      granule
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
        granule_cumulus_id: granuleCumulusId,
        execution_cumulus_id: executionCumulusId,
      }
    )
  );
});

test('GranulePgModel.delete() deletes granule and file records', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
  } = t.context;

  const filePgModel = new FilePgModel();
  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });
  let file;

  await knex.transaction(async (trx) => {
    const [innerGranuleCumulusId] = await granulePgModel.create(trx, granule);
    file = fakeFileRecordFactory({
      granule_cumulus_id: innerGranuleCumulusId,
    });
    await filePgModel.create(trx, file);
    return innerGranuleCumulusId;
  });

  t.true(
    await granulePgModel.exists(
      knex,
      {
        granule_id: granule.granule_id,
        collection_cumulus_id: collectionCumulusId,
      }
    )
  );
  t.true(
    await filePgModel.exists(
      knex,
      file
    )
  );

  await knex.transaction(
    (trx) => granulePgModel.delete(
      trx,
      granule
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
    await filePgModel.exists(
      knex,
      file
    )
  );
});
