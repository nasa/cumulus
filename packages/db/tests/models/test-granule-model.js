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
  migrationDir,
  createRejectableTransaction,
} = require('../../dist');

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

test('GranulePgModel.exists() finds granule by granule_id and collection_cumulus_id <PostgresGranuleUniqueColumns>', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });

  await granulePgModel.upsert(knex, granule, executionCumulusId);

  t.true(await granulePgModel.exists(
    knex,
    {
      granule_id: granule.granule_id,
      collection_cumulus_id: collectionCumulusId,
    }
  ));
});

test('GranulePgModel.exists() find granule for cumulusId <RecordSelect>', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });

  const cumulusId = await granulePgModel.upsert(knex, granule, executionCumulusId);

  t.true(
    await granulePgModel.exists(
      knex,
      { cumulus_id: Number(cumulusId) }
    )
  );
});

test('GranulePgModel.exists() throws error if params do not satisfy type PostgresGranuleUniqueColumns|{cumulus_id: number}', async (t) => {
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
  const searchParams = { granule_id: granule.granule_id };

  await granulePgModel.upsert(knex, granule, executionCumulusId);

  await t.throwsAsync(
    granulePgModel.exists(knex, searchParams),
    { message: `Cannot find granule, must provide either granule_id and collection_cumulus_id or cumulus_id: params(${JSON.stringify(searchParams)})` }
  );
});

test('GranulePgModel.get() returns granule by granule_id and collection_cumulus_id <PostgresGranuleUniqueColumns>', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });

  await granulePgModel.upsert(knex, granule, executionCumulusId);

  t.like(
    await granulePgModel.get(
      knex,
      {
        granule_id: granule.granule_id,
        collection_cumulus_id: collectionCumulusId,
      }
    ),
    granule
  );
});

test('GranulePgModel.get() returns granule for cumulusId <RecordSelect>', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });

  const cumulusId = await granulePgModel.upsert(knex, granule, executionCumulusId);

  t.like(
    await granulePgModel.get(
      knex,
      { cumulus_id: Number(cumulusId) }
    ),
    granule
  );
});

test('GranulePgModel.get() throws error if params do not satisfy type PostgresGranuleUniqueColumns|{cumulus_id: number}', async (t) => {
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
  const searchParams = { granule_id: granule.granule_id };

  await granulePgModel.upsert(knex, granule, executionCumulusId);

  await t.throwsAsync(
    async () => await granulePgModel.get(knex, searchParams),
    { message: `Cannot find granule, must provide either granule_id and collection_cumulus_id or cumulus_id: params(${JSON.stringify(searchParams)})` }
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
    await granulePgModel.get(knex, {
      granule_id: granule.granule_id,
      collection_cumulus_id: collectionCumulusId,
    }),
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
    await granulePgModel.get(knex, {
      granule_id: granule.granule_id, collection_cumulus_id: collectionCumulusId,
    }),
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
    await granulePgModel.get(knex, {
      granule_id: granule.granule_id,
      collection_cumulus_id: collectionCumulusId,
    }),
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

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
    collection_cumulus_id: collectionCumulusId,
  });
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

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
    collection_cumulus_id: collectionCumulusId,
  });
  t.is(record.status, 'running');
});

test('GranulePgModel.upsert() will not allow a queued status to replace a completed status for same execution', async (t) => {
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
    status: 'queued',
  };

  await granulePgModel.upsert(knex, updatedGranule, executionCumulusId);

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
    collection_cumulus_id: collectionCumulusId,
  });
  t.is(record.status, 'completed');
});

test('GranulePgModel.upsert() will not allow a queued status to replace a running status for same execution', async (t) => {
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
    status: 'queued',
  };

  await granulePgModel.upsert(knex, updatedGranule, executionCumulusId);

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
    collection_cumulus_id: collectionCumulusId,
  });
  t.is(record.status, 'running');
});

test('GranulePgModel.upsert() will allow a queued status to replace a non-queued status for a different execution', async (t) => {
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

  const [newExecutionCumulusId] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'running' })
  );

  await upsertGranuleWithExecutionJoinRecord(knex, granule, executionCumulusId);

  const updatedGranule = {
    ...granule,
    status: 'queued',
  };

  await granulePgModel.upsert(knex, updatedGranule, newExecutionCumulusId);

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
    collection_cumulus_id: collectionCumulusId,
  });
  t.is(record.status, 'queued');
});

test('GranulePgModel.upsert() will allow a completed status to replace a queued status for the same execution', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'queued',
    collection_cumulus_id: collectionCumulusId,
  });

  await upsertGranuleWithExecutionJoinRecord(knex, granule, executionCumulusId);

  const updatedGranule = {
    ...granule,
    status: 'completed',
  };

  await granulePgModel.upsert(knex, updatedGranule);

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
    collection_cumulus_id: collectionCumulusId,
  });
  t.is(record.status, 'completed');
});

test('GranulePgModel.upsert() will allow a running status to replace a queued status for the same execution', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'queued',
    collection_cumulus_id: collectionCumulusId,
  });

  await upsertGranuleWithExecutionJoinRecord(knex, granule, executionCumulusId);

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await granulePgModel.upsert(knex, updatedGranule);

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
    collection_cumulus_id: collectionCumulusId,
  });
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

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
    collection_cumulus_id: collectionCumulusId,
  });
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

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
    collection_cumulus_id: collectionCumulusId,
  });
  t.is(record.status, 'completed');
});

test('GranulePgModel.upsert() succeeds without an execution for completed granule', async (t) => {
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

test('GranulePgModel.upsert() succeeds without an execution for running granule', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'running',
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

  const granuleCumulusId = await createRejectableTransaction(knex, async (trx) => {
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

  await createRejectableTransaction(
    knex,
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

  await createRejectableTransaction(knex, async (trx) => {
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

  await createRejectableTransaction(
    knex,
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
