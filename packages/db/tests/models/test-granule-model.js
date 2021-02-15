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

const {
  GranuleExecutionHistoryPgModel,
} = require('../../dist/models/granule-execution-history');

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
  t.context.granuleExecutionHistoryPgModel = new GranuleExecutionHistoryPgModel();

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

test('getWithExecutionHistory returns execution history for granule with one execution', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
    granuleExecutionHistoryPgModel,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'running',
  });

  const [granuleCumulusId] = await granulePgModel.create(
    knex,
    granule
  );

  await granuleExecutionHistoryPgModel.create(knex, {
    granule_cumulus_id: granuleCumulusId,
    execution_cumulus_id: executionCumulusId,
  });

  const [granuleWithHistory] = await granulePgModel.getWithExecutionHistory(
    knex,
    granule
  );

  t.like(
    granuleWithHistory,
    {
      ...granule,
      cumulus_id: granuleCumulusId,
      execution_cumulus_ids: [executionCumulusId],
    }
  );
});

test('getWithExecutionHistory returns execution history for granule with multiple executions', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
    executionPgModel,
    granuleExecutionHistoryPgModel,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'running',
  });

  const [granuleCumulusId] = await granulePgModel.create(
    knex,
    granule
  );

  await granuleExecutionHistoryPgModel.create(knex, {
    granule_cumulus_id: granuleCumulusId,
    execution_cumulus_id: executionCumulusId,
  });

  const [newExecutionCumulusId] = await executionPgModel.create(
    knex,
    fakeExecutionRecordFactory()
  );

  await granuleExecutionHistoryPgModel.create(knex, {
    granule_cumulus_id: granuleCumulusId,
    execution_cumulus_id: newExecutionCumulusId,
  });

  const [granuleWithHistory] = await granulePgModel.getWithExecutionHistory(
    knex,
    granule
  );

  t.like(
    granuleWithHistory,
    {
      ...granule,
      cumulus_id: granuleCumulusId,
      execution_cumulus_ids: [executionCumulusId, newExecutionCumulusId],
    }
  );
});

test('GranulePgModel.createWithExecutionHistory() creates a new granule with execution history', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
    granuleExecutionHistoryPgModel,
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
    await granuleExecutionHistoryPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ),
    [{
      granule_cumulus_id: Number.parseInt(granuleCumulusId, 10),
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
    granuleExecutionHistoryPgModel,
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
    await granuleExecutionHistoryPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ),
    [{
      granule_cumulus_id: Number.parseInt(granuleCumulusId, 10),
      execution_cumulus_id: executionCumulusId,
    }]
  );
});

test('GranulePgModel.createWithExecutionHistory() does not commit granule or execution history if execution history write fails', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
    granuleExecutionHistoryPgModel,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'running',
  });

  const fakeGranuleExecutionHistoryPgModel = {
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
          fakeGranuleExecutionHistoryPgModel
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
    await granuleExecutionHistoryPgModel.exists(
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

test('GranulePgModel.upsertWithExecutionHistory() adds execution history', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
    granuleExecutionHistoryPgModel,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'running',
  });

  const [granuleCumulusId] = await granulePgModel.upsertWithExecutionHistory(
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
    await granuleExecutionHistoryPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ),
    [{
      granule_cumulus_id: Number.parseInt(granuleCumulusId, 10),
      execution_cumulus_id: executionCumulusId,
    }]
  );
});

test('GranulePgModel.upsertWithExecutionHistory() handles multiple executions for a granule', async (t) => {
  const {
    knex,
    granulePgModel,
    executionPgModel,
    granuleExecutionHistoryPgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'completed',
  });

  const [granuleCumulusId] = await granulePgModel.upsertWithExecutionHistory(
    knex,
    granule,
    executionCumulusId
  );

  const [secondExecutionCumulusId] = await executionPgModel.create(
    knex,
    fakeExecutionRecordFactory()
  );

  await granulePgModel.upsertWithExecutionHistory(
    knex,
    granule,
    secondExecutionCumulusId
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
    await granuleExecutionHistoryPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ),
    [executionCumulusId, secondExecutionCumulusId].map((executionId) => ({
      granule_cumulus_id: Number.parseInt(granuleCumulusId, 10),
      execution_cumulus_id: executionId,
    }))
  );
});

test('GranulePgModel.upsertWithExecutionHistory() works with transaction', async (t) => {
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

  const [granuleCumulusId] = await knex.transaction(
    (trx) =>
      granulePgModel.upsertWithExecutionHistory(
        trx,
        granule,
        executionCumulusId
      )
  );

  const [granuleWithHistory] = await granulePgModel.getWithExecutionHistory(
    knex,
    granule
  );

  t.like(
    granuleWithHistory,
    {
      ...granule,
      cumulus_id: granuleCumulusId,
      execution_cumulus_ids: [executionCumulusId],
    }
  );
});

test('GranulePgModel.upsertWithExecutionHistory() does not write anything if execution history upsert fails', async (t) => {
  const {
    knex,
    granulePgModel,
    collectionCumulusId,
    executionCumulusId,
    granuleExecutionHistoryPgModel,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'running',
  });

  const fakeGranuleExecutionHistoryPgModel = {
    upsert: async () => {
      throw new Error('error');
    },
  };

  await t.throwsAsync(
    knex.transaction(
      (trx) =>
        granulePgModel.upsertWithExecutionHistory(
          trx,
          granule,
          executionCumulusId,
          fakeGranuleExecutionHistoryPgModel
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
    await granuleExecutionHistoryPgModel.exists(
      knex,
      {
        execution_cumulus_id: executionCumulusId,
      }
    )
  );
});

test('GranulePgModel.upsertWithExecutionHistory() will allow a running status to replace a completed status for different execution', async (t) => {
  const {
    knex,
    granulePgModel,
    executionPgModel,
    granuleExecutionHistoryPgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'completed',
  });

  const [granuleCumulusId] = await granulePgModel.upsertWithExecutionHistory(
    knex,
    granule,
    executionCumulusId
  );

  const [secondExecutionCumulusId] = await executionPgModel.create(
    knex,
    fakeExecutionRecordFactory()
  );

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await granulePgModel.upsertWithExecutionHistory(
    knex,
    updatedGranule,
    secondExecutionCumulusId
  );

  const granuleRecord = await granulePgModel.get(
    knex,
    updatedGranule
  );

  t.like(
    granuleRecord,
    {
      ...updatedGranule,
      cumulus_id: granuleCumulusId,
    }
  );
  t.deepEqual(
    await granuleExecutionHistoryPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ),
    [executionCumulusId, secondExecutionCumulusId].map((executionId) => ({
      granule_cumulus_id: Number.parseInt(granuleCumulusId, 10),
      execution_cumulus_id: executionId,
    }))
  );
});
