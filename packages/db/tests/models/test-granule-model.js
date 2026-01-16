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

  const [pgCollection] = await collectionPgModel.create(
    t.context.knex,
    t.context.collection
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;

  t.context.executionPgModel = new ExecutionPgModel();
});

test.beforeEach(async (t) => {
  const [pgExecution] = await t.context.executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory()
  );
  t.context.executionCumulusId = pgExecution.cumulus_id;

  const [completedPgExecution] = await t.context.executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'completed' })
  );
  t.context.completedExecutionCumulusId = completedPgExecution.cumulus_id;
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('GranulePgModel.exists() finds granule by granule_id <PostgresGranuleUniqueColumns>', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });

  await granulePgModel.upsert({ knexOrTrx: knex, granule, executionCumulusId });

  t.true(await granulePgModel.exists(
    knex,
    {
      granule_id: granule.granule_id,
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

  const [pgGranule] = await granulePgModel.upsert({ knexOrTrx: knex, granule, executionCumulusId });

  t.true(
    await granulePgModel.exists(
      knex,
      { cumulus_id: Number(pgGranule.cumulus_id) }
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
  const searchParams = { no_granule_id: granule.granule_id };

  await granulePgModel.upsert({ knexOrTrx: knex, granule, executionCumulusId });

  await t.throwsAsync(
    granulePgModel.exists(knex, searchParams),
    { message: `Cannot find granule, must provide either granule_id or cumulus_id: params(${JSON.stringify(searchParams)})` }
  );
});

test('GranulePgModel.get() returns granule by granule_id <PostgresGranuleUniqueColumns>', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });

  await granulePgModel.upsert({ knexOrTrx: knex, granule, executionCumulusId });

  t.like(
    await granulePgModel.get(
      knex,
      {
        granule_id: granule.granule_id,
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

  const [pgGranule] = await granulePgModel.upsert({ knexOrTrx: knex, granule, executionCumulusId });

  t.like(
    await granulePgModel.get(
      knex,
      { cumulus_id: Number(pgGranule.cumulus_id) }
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
  const searchParams = { no_granule_id: granule.granule_id };

  await granulePgModel.upsert({ knexOrTrx: knex, granule, executionCumulusId });

  await t.throwsAsync(
    async () => await granulePgModel.get(knex, searchParams),
    { message: `Cannot find granule, must provide either granule_id or cumulus_id: params(${JSON.stringify(searchParams)})` }
  );
});

test('GranulePgModel.upsert() creates a new running granule if writeConstraints is set to true', async (t) => {
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

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule,
    executionCumulusId,
    writeConstraints: true,
  });

  t.like(
    await granulePgModel.get(knex, granule),
    granule
  );
});

test('GranulePgModel.upsert() creates a new running granule if writeConstraints is set to false', async (t) => {
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

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule,
    executionCumulusId,
    writeConstraints: false,
  });

  t.like(
    await granulePgModel.get(knex, granule),
    granule
  );
});

test('GranulePgModel.upsert() will only overwrite allowed fields of a granule if update is to set status to running, and writeConstraints is set to true and write conditions are met', async (t) => {
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
  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const [newExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'running' })
  );
  const newExecutionCumulusId = newExecution.cumulus_id;

  const updatedGranule = {
    ...fakeGranuleRecordFactory({
      status: 'running',
      collection_cumulus_id: collectionCumulusId,
      granule_id: granule.granule_id,
      producer_granule_id: granule.producer_granule_id,
      published: true,
      duration: 100,
      time_to_archive: 100,
      time_to_process: 100,
      product_volume: 100,
      error: {},
      cmr_link: 'testvalue',
      query_fields: {},
    }),
    timestamp: new Date(Date.now() + 1000),
    updated_at: new Date(Date.now() + 1000),
    created_at: new Date(Date.now() + 1000),
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: newExecutionCumulusId,
    writeConstraints: true,
  });

  t.like(
    await granulePgModel.get(knex, {
      granule_id: granule.granule_id,
    }),
    {
      ...granule,
      timestamp: updatedGranule.timestamp,
      updated_at: updatedGranule.updated_at,
      created_at: updatedGranule.created_at,
      status: 'running',
    }
  );
});

test('GranulePgModel.upsert() overwrites all fields of a granule if update is to set status to running, and writeConstraints is set to false', async (t) => {
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
  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const [newExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'running' })
  );
  const newExecutionCumulusId = newExecution.cumulus_id;

  const updatedGranule = {
    ...fakeGranuleRecordFactory({
      status: 'running',
      collection_cumulus_id: collectionCumulusId,
      granule_id: granule.granule_id,
      published: true,
      duration: 100,
      time_to_archive: 100,
      time_to_process: 100,
      product_volume: '100',
      error: {},
      cmr_link: 'testvalue',
      query_fields: {},
    }),
    timestamp: new Date(Date.now() + 1000),
    updated_at: new Date(Date.now() + 1000),
    created_at: new Date(Date.now() + 1000),
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: newExecutionCumulusId,
    writeConstraints: false,
  });

  t.like(
    await granulePgModel.get(knex, {
      granule_id: granule.granule_id,
    }),
    updatedGranule
  );
});

test('GranulePgModel.upsert() will overwrite allowed fields of a running granule for a different execution if writeConstraints is set to true', async (t) => {
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
  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const [newExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'running' })
  );
  const newExecutionCumulusId = newExecution.cumulus_id;

  const updatedGranule = {
    ...granule,
    timestamp: new Date(Date.now() + 1000),
    updated_at: new Date(Date.now() + 1000),
    created_at: new Date(Date.now() + 1000),
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: newExecutionCumulusId,
    writeConstraints: true,
  });

  t.like(
    await granulePgModel.get(knex, {
      granule_id: granule.granule_id,
    }),
    updatedGranule
  );
});

test('GranulePgModel.upsert() will overwrite allowed fields of a running granule for a different execution if writeConstraints is set to false', async (t) => {
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
  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const [newExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'running' })
  );
  const newExecutionCumulusId = newExecution.cumulus_id;

  const updatedGranule = {
    ...granule,
    timestamp: new Date(Date.now() + 1000),
    updated_at: new Date(Date.now() + 1000),
    created_at: new Date(Date.now() + 1000),
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: newExecutionCumulusId,
    writeConstraints: false,
  });

  t.like(
    await granulePgModel.get(knex, {
      granule_id: granule.granule_id,
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

  await granulePgModel.upsert({ knexOrTrx: knex, granule, executionCumulusId });

  t.like(
    await granulePgModel.get(knex, granule),
    granule
  );
});

test('GranulePgModel.upsert() overwrites a completed granule if writeConstraints is set to true', async (t) => {
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

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const updatedGranule = {
    ...granule,
    product_volume: 100,
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId,
    writeConstraints: true,
  });

  t.like(
    await granulePgModel.get(knex, {
      granule_id: granule.granule_id,
    }),
    {
      ...updatedGranule,
      product_volume: '100',
    }
  );
});

test('GranulePgModel.upsert() overwrites a completed granule if writeConstraints is set to false', async (t) => {
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

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const updatedGranule = {
    ...granule,
    product_volume: 100,
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId,
    writeConstraints: false,
  });

  t.like(
    await granulePgModel.get(knex, {
      granule_id: granule.granule_id,
    }),
    {
      ...updatedGranule,
      product_volume: '100',
    }
  );
});

test('GranulePgModel.upsert() will allow a completed status to replace a running status for same execution if writeConstraints is set to true', async (t) => {
  const { knex, granulePgModel, collectionCumulusId, executionCumulusId } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'running',
    collection_cumulus_id: collectionCumulusId,
  });

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const updatedGranule = {
    ...granule,
    status: 'completed',
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId,
    writeConstraints: true,
  });

  t.like(
    await granulePgModel.get(knex, {
      granule_id: granule.granule_id,
    }),
    updatedGranule
  );
});

test('GranulePgModel.upsert() will allow a completed status to replace a running status for same execution if writeConstraints is set to false', async (t) => {
  const { knex, granulePgModel, collectionCumulusId, executionCumulusId } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'running',
    collection_cumulus_id: collectionCumulusId,
  });

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const updatedGranule = {
    ...granule,
    status: 'completed',
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId,
    writeConstraints: false,
  });

  t.like(
    await granulePgModel.get(knex, {
      granule_id: granule.granule_id,
    }),
    updatedGranule
  );
});

test('GranulePgModel.upsert() will not allow a running status to replace a completed status for same execution if writeConstraints is set to true', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    completedExecutionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'completed',
    collection_cumulus_id: collectionCumulusId,
  });

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId: completedExecutionCumulusId,
  });

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: completedExecutionCumulusId,
    writeConstraints: true,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.like(record, granule);
  t.is(record.status, 'completed');
});

test('GranulePgModel.upsert() will allow a running status to replace a completed status for same execution if writeConstraints is set to false', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    completedExecutionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'completed',
    collection_cumulus_id: collectionCumulusId,
  });

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId: completedExecutionCumulusId,
  });

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: completedExecutionCumulusId,
    writeConstraints: false,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.like(record, updatedGranule);
  t.is(record.status, 'running');
});

test('GranulePgModel.upsert() will allow a running status to replace a non-running status for different execution if writeConstraints is set to true', async (t) => {
  const {
    knex,
    executionPgModel,
    granulePgModel,
    collectionCumulusId,
    completedExecutionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'completed',
    collection_cumulus_id: collectionCumulusId,
  });

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId: completedExecutionCumulusId,
  });

  const [newExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'running' })
  );
  const newExecutionCumulusId = newExecution.cumulus_id;

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: newExecutionCumulusId,
    writeConstraints: true,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.like(record, updatedGranule);
  t.is(record.status, 'running');
});

test('GranulePgModel.upsert() will allow a running status to replace a non-running status for different execution if writeConstraints is set to false', async (t) => {
  const {
    knex,
    executionPgModel,
    granulePgModel,
    collectionCumulusId,
    completedExecutionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'completed',
    collection_cumulus_id: collectionCumulusId,
  });

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId: completedExecutionCumulusId,
  });

  const [newExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'running' })
  );
  const newExecutionCumulusId = newExecution.cumulus_id;

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: newExecutionCumulusId,
    writeConstraints: false,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.like(record, updatedGranule);
  t.is(record.status, 'running');
});

test('GranulePgModel.upsert() will allow a newer running status to replace an older non-running status for different execution if writeConstraints is set to true', async (t) => {
  const {
    knex,
    executionPgModel,
    granulePgModel,
    collectionCumulusId,
    completedExecutionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'completed',
    collection_cumulus_id: collectionCumulusId,
  });

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId: completedExecutionCumulusId,
  });

  const [newExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'running' })
  );
  const newExecutionCumulusId = newExecution.cumulus_id;

  const updatedDate = new Date();
  const updatedGranule = {
    ...granule,
    status: 'running',
    created_at: updatedDate,
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: newExecutionCumulusId,
    writeConstraints: true,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.is(record.status, 'running');
  t.like(record, updatedGranule);
  t.deepEqual(record.created_at, updatedDate);
});

test('GranulePgModel.upsert() will allow a newer running status to replace an older non-running status for different execution if writeConstraints is set to false', async (t) => {
  const {
    knex,
    executionPgModel,
    granulePgModel,
    collectionCumulusId,
    completedExecutionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'completed',
    collection_cumulus_id: collectionCumulusId,
  });

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId: completedExecutionCumulusId,
  });

  const [newExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'running' })
  );
  const newExecutionCumulusId = newExecution.cumulus_id;

  const updatedDate = new Date();
  const updatedGranule = {
    ...granule,
    status: 'running',
    created_at: updatedDate,
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: newExecutionCumulusId,
    writeConstraints: false,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.is(record.status, 'running');
  t.like(record, updatedGranule);
  t.deepEqual(record.created_at, updatedDate);
});

test('GranulePgModel.upsert() will allow an older running status to replace a newer non-running status for different execution if writeConstraints is set to false', async (t) => {
  const {
    knex,
    executionPgModel,
    granulePgModel,
    collectionCumulusId,
    completedExecutionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'completed',
    collection_cumulus_id: collectionCumulusId,
  });

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId: completedExecutionCumulusId,
  });

  const [newExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'running' })
  );
  const newExecutionCumulusId = newExecution.cumulus_id;

  const updatedGranule = {
    ...granule,
    status: 'running',
    created_at: new Date(1),
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: newExecutionCumulusId,
    writeConstraints: false,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.is(record.status, 'running');
  t.like(record, updatedGranule);
  t.deepEqual(record.created_at, updatedGranule.created_at);
});

test('GranulePgModel.upsert() will not allow an older running status to replace a newer non-running status for different execution if writeConstraints is set to true', async (t) => {
  const {
    knex,
    executionPgModel,
    granulePgModel,
    collectionCumulusId,
    completedExecutionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'completed',
    collection_cumulus_id: collectionCumulusId,
  });

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId: completedExecutionCumulusId,
  });

  const [newExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'running' })
  );
  const newExecutionCumulusId = newExecution.cumulus_id;

  const updatedGranule = {
    ...granule,
    status: 'running',
    created_at: new Date(1),
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: newExecutionCumulusId,
    writeConstraints: true,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.is(record.status, 'completed');
  t.like(record, granule);
  t.deepEqual(record.created_at, granule.created_at);
});

test('GranulePgModel.upsert() will not allow a queued status to replace a completed status for same execution if writeConstraints is set to true', async (t) => {
  const {
    collectionCumulusId,
    completedExecutionCumulusId,
    granulePgModel,
    knex,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'completed',
    collection_cumulus_id: collectionCumulusId,
  });

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId: completedExecutionCumulusId,
    writeConstraints: true,
  });

  const updatedGranule = {
    ...granule,
    status: 'queued',
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: completedExecutionCumulusId,
    writeConstraints: true,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.like(record, granule);
  t.is(record.status, 'completed');
});

test('GranulePgModel.upsert() will allow a queued status to replace a completed status for same execution if writeConstraints is set to false', async (t) => {
  const {
    collectionCumulusId,
    completedExecutionCumulusId,
    granulePgModel,
    knex,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'completed',
    collection_cumulus_id: collectionCumulusId,
  });

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId: completedExecutionCumulusId,
  });

  const updatedGranule = {
    ...granule,
    status: 'queued',
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: completedExecutionCumulusId,
    writeConstraints: false,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.like(record, updatedGranule);
  t.is(record.status, 'queued');
});

test('GranulePgModel.upsert() will not allow a queued status to replace a running status for same execution if writeConstraints is set to true', async (t) => {
  const { knex, granulePgModel, collectionCumulusId, executionCumulusId } = t.context;

  const granule = fakeGranuleRecordFactory({
    status: 'running',
    collection_cumulus_id: collectionCumulusId,
  });

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
    writeConstraints: true,
  });

  const updatedGranule = {
    ...granule,
    status: 'queued',
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId,
    writeConstraints: true,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.is(record.status, 'running');
  t.like(record, granule);
});

test('GranulePgModel.upsert() will allow a queued status to replace a running status for same execution if writeConstraints is set to false', async (t) => {
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

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const updatedGranule = {
    ...granule,
    status: 'queued',
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId,
    writeConstraints: false,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.is(record.status, 'queued');
  t.like(record, updatedGranule);
});

test('GranulePgModel.upsert() will allow a queued status to replace a non-queued status for a different execution if writeConstraints is set to false', async (t) => {
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

  const [execution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'running' })
  );
  const newExecutionCumulusId = execution.cumulusId;

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const updatedGranule = {
    ...granule,
    status: 'queued',
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: newExecutionCumulusId,
    writeConstraints: false,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.is(record.status, 'queued');
});

test('GranulePgModel.upsert() will allow a queued status to replace a non-queued status for a different execution if writeConstraints is set to true', async (t) => {
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

  const [execution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'running' })
  );
  const newExecutionCumulusId = execution.cumulusId;

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
    writeConstraints: true,
  });

  const updatedGranule = {
    ...granule,
    status: 'queued',
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: newExecutionCumulusId,
    writeConstraints: true,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.is(record.status, 'queued');
});

test('GranulePgModel.upsert() will allow a completed status to replace a queued status for the same execution if writeConstraints is set to true', async (t) => {
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

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const updatedGranule = {
    ...granule,
    status: 'completed',
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    writeConstraints: true,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.is(record.status, 'completed');
});

test('GranulePgModel.upsert() will allow a completed status to replace a queued status for the same execution if writeConstraints is set to false', async (t) => {
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

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const updatedGranule = {
    ...granule,
    status: 'completed',
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    writeConstraints: false,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.is(record.status, 'completed');
});

test('GranulePgModel.upsert() will allow a running granule status to replace a queued status for the same execution if writeConstraints is set to true', async (t) => {
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

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
    writeConstraints: true,
  });

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await granulePgModel.upsert({ knexOrTrx: knex, granule: updatedGranule });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.is(record.status, 'running');
});

test('GranulePgModel.upsert() will allow a running granule status to replace a queued status for the same execution if writeConstraints is set to false', async (t) => {
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

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
    writeConstraints: false,
  });

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await granulePgModel.upsert({ knexOrTrx: knex, granule: updatedGranule });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.is(record.status, 'running');
});

test('GranulePgModel.upsert() will not allow a final granule status from an older completed execution to overwrite the completed granule status from a newer execution if writeConstraints is set to true', async (t) => {
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

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const [newExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'completed' })
  );
  const newExecutionCumulusId = newExecution.cumulus_id;

  const updatedGranule = {
    ...granule,
    status: 'failed',
    created_at: new Date(Date.now() - 100000),
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: newExecutionCumulusId,
    writeConstraints: true,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.like(record, granule);
  t.is(record.status, 'completed');
});

test('GranulePgModel.upsert() will allow a final granule status from an older completed execution to overwrite the completed granule status from a newer execution if writeConstraints is set to false', async (t) => {
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

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const [newExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'completed' })
  );
  const newExecutionCumulusId = newExecution.cumulus_id;

  const updatedGranule = {
    ...granule,
    status: 'failed',
    created_at: new Date(Date.now() - 100000),
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: newExecutionCumulusId,
    writeConstraints: false,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.is(record.status, 'failed');
  t.like(record, updatedGranule);
});

test.serial('GranulePgModel.upsert() will not allow a running granule linked to a completed execution to overwrite and writeConstraints is set to true', async (t) => {
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

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const [newExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'failed' })
  );
  const newExecutionCumulusId = newExecution.cumulus_id;

  const updatedGranule = {
    ...granule,
    status: 'running',
    created_at: new Date(),
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: newExecutionCumulusId,
    writeConstraints: true,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.is(record.status, 'completed');
  t.like(record, granule);
});

test.serial('GranulePgModel.upsert() will allow a running granule linked to a completed execution to overwrite and writeConstraints is set to false', async (t) => {
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

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const [newExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'failed' })
  );
  const newExecutionCumulusId = newExecution.cumulus_id;

  const updatedGranule = {
    ...granule,
    status: 'running',
    created_at: new Date(),
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: newExecutionCumulusId,
    writeConstraints: false,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.is(record.status, 'running');
  t.like(record, updatedGranule);
});

test.serial('GranulePgModel.upsert() will not allow a running granule linked to a completed execution with default writeConstraints set', async (t) => {
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

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const [newExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'failed' })
  );
  const newExecutionCumulusId = newExecution.cumulus_id;

  const updatedGranule = {
    ...granule,
    status: 'running',
    created_at: new Date(),
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: newExecutionCumulusId,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.is(record.status, 'completed');
});

test.serial('GranulePgModel.upsert() throws if a granule upsert is attempted for a running granule without created_at and writeConstraints is set to true', async (t) => {
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

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const [newExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'running' })
  );
  const newExecutionCumulusId = newExecution.cumulus_id;

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  delete updatedGranule.created_at;

  await t.throwsAsync(
    granulePgModel.upsert({
      knexOrTrx: knex,
      granule: updatedGranule,
      executionCumulusId: newExecutionCumulusId,
      writeConstraints: true,
    })
  );

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.like(record, granule);
});

test.serial('GranulePgModel.upsert() throws if a granule upsert is attempted for a queued granule without created_at and writeConstraints is set to true', async (t) => {
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

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const [newExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'running' })
  );
  const newExecutionCumulusId = newExecution.cumulus_id;

  const updatedGranule = {
    ...granule,
    status: 'queued',
  };

  delete updatedGranule.created_at;

  await t.throwsAsync(
    granulePgModel.upsert({
      knexOrTrx: knex,
      granule: updatedGranule,
      executionCumulusId: newExecutionCumulusId,
      writeConstraints: true,
    })
  );

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.like(record, granule);
});

test.serial('GranulePgModel.upsert() will allow a running state granule referencing completed state execution to overwrite an existing completed state granule referencing a different completed state execution when writeConstraints is set to false', async (t) => {
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

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const [newExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'completed' })
  );
  const newExecutionCumulusId = newExecution.cumulus_id;

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: newExecutionCumulusId,
    writeConstraints: false,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.is(record.status, 'running');
  t.like(record, updatedGranule);
  t.deepEqual(record.created_at, granule.created_at);
});

test.serial('GranulePgModel.upsert() will not allow a running state granule referencing completed state execution to overwrite an existing completed state granule referencing a different completed state execution when writeConstraints is set to true', async (t) => {
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

  await upsertGranuleWithExecutionJoinRecord({
    knexTransaction: knex,
    granule,
    executionCumulusId,
  });

  const [newExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ status: 'completed' })
  );
  const newExecutionCumulusId = newExecution.cumulus_id;

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await granulePgModel.upsert({
    knexOrTrx: knex,
    granule: updatedGranule,
    executionCumulusId: newExecutionCumulusId,
    writeConstraints: true,
  });

  const record = await granulePgModel.get(knex, {
    granule_id: granule.granule_id,
  });
  t.is(record.status, 'completed');
  t.like(record, granule);
  t.deepEqual(record.created_at, granule.created_at);
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

  await granulePgModel.upsert({ knexOrTrx: knex, granule });
  t.true(await granulePgModel.exists(knex, granule));
});

test('GranulePgModel.upsert() throws an error for a granule with status of "completed" without createdAt set when write constraints are set to true', async (t) => {
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
  delete granule.created_at;

  await t.throwsAsync(
    granulePgModel.upsert({
      knexOrTrx: knex,
      granule,
      executionCumulusId,
      writeConstraints: true,
    })
  );
});

test('GranulePgModel.upsert() succeeds for a granule with status of "completed" without createdAt set when write constraints are set to false and sets a default value', async (t) => {
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
  delete granule.created_at;

  const response = await granulePgModel.upsert({
    knexOrTrx: knex,
    granule,
    executionCumulusId,
    writeConstraints: false,
  });
  t.truthy(response[0].created_at);
  t.false(granule.created_at === response[0].created_at);
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

  await granulePgModel.upsert({ knexOrTrx: knex, granule });
  t.true(await granulePgModel.exists(knex, granule));
});

test('GranulePgModel.deleteExcluding throws Error', async (t) => {
  const { knex, granulePgModel } = t.context;
  await t.throwsAsync(
    granulePgModel.deleteExcluding({ knexOrTransaction: knex })
  );
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
    const [innerPgGranule] = await granulePgModel.create(trx, granule);
    const innerGranuleCumulusId = innerPgGranule.cumulus_id;
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
    const [pgGranule] = await granulePgModel.create(trx, granule);
    const innerGranuleCumulusId = pgGranule.cumulus_id;
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
