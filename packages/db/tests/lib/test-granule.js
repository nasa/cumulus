const test = require('ava');
const sinon = require('sinon');
const cryptoRandomString = require('crypto-random-string');

const { RecordDoesNotExist } = require('@cumulus/errors');
const { constructCollectionId, deconstructCollectionId } = require('@cumulus/message/Collections');
const {
  CollectionPgModel,
  ExecutionPgModel,
  GranulePgModel,
  GranulesExecutionsPgModel,
  generateLocalTestDb,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeGranuleRecordFactory,
  getApiGranuleExecutionCumulusIds,
  getUniqueGranuleByGranuleId,
  upsertGranuleWithExecutionJoinRecord,
} = require('../../dist');

const { migrationDir } = require('../../../../lambdas/db-migration/dist/lambda');

const testDbName = `granule_lib_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.granulePgModel = new GranulePgModel();
  t.context.granulesExecutionsPgModel = new GranulesExecutionsPgModel();

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.collection = fakeCollectionRecordFactory();
  const collectionResponse = await t.context.collectionPgModel.create(
    t.context.knex,
    t.context.collection
  );
  t.context.collectionCumulusId = collectionResponse[0].cumulus_id;

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

test('upsertGranuleWithExecutionJoinRecord() creates granule record with granule/execution join record', async (t) => {
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
    (trx) => upsertGranuleWithExecutionJoinRecord(
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

test('upsertGranuleWithExecutionJoinRecord() handles multiple executions for a granule', async (t) => {
  const {
    knex,
    granulePgModel,
    executionPgModel,
    granulesExecutionsPgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'completed',
  });

  const [granuleCumulusId] = await knex.transaction(
    (trx) => upsertGranuleWithExecutionJoinRecord(
      trx,
      granule,
      executionCumulusId
    )
  );

  const [secondExecutionCumulusId] = await executionPgModel.create(
    knex,
    fakeExecutionRecordFactory()
  );

  await knex.transaction(
    (trx) => upsertGranuleWithExecutionJoinRecord(
      trx,
      granule,
      secondExecutionCumulusId
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
    [executionCumulusId, secondExecutionCumulusId].map((executionId) => ({
      granule_cumulus_id: Number(granuleCumulusId),
      execution_cumulus_id: executionId,
    }))
  );
});

test('upsertGranuleWithExecutionJoinRecord() does not write anything if upserting granule/execution join record fails', async (t) => {
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
    upsert: () => Promise.reject(new Error('error')),
  };

  await t.throwsAsync(
    knex.transaction(
      (trx) =>
        upsertGranuleWithExecutionJoinRecord(
          trx,
          granule,
          executionCumulusId,
          undefined,
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

test('upsertGranuleWithExecutionJoinRecord() will allow a running status to replace a non-running status for different execution', async (t) => {
  const {
    knex,
    granulePgModel,
    executionPgModel,
    granulesExecutionsPgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'completed',
  });

  const [granuleCumulusId] = await upsertGranuleWithExecutionJoinRecord(
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

  await upsertGranuleWithExecutionJoinRecord(
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
    await granulesExecutionsPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ),
    [executionCumulusId, secondExecutionCumulusId].map((executionId) => ({
      granule_cumulus_id: Number(granuleCumulusId),
      execution_cumulus_id: executionId,
    }))
  );
});

test('upsertGranuleWithExecutionJoinRecord() succeeds if granulePgModel.upsert() affects no rows', async (t) => {
  const {
    knex,
    granulePgModel,
    granulesExecutionsPgModel,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'completed',
  });

  const [granuleCumulusId] = await upsertGranuleWithExecutionJoinRecord(
    knex,
    granule,
    executionCumulusId
  );

  const updatedGranule = {
    ...granule,
    status: 'running',
  };

  await upsertGranuleWithExecutionJoinRecord(
    knex,
    updatedGranule,
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
    [executionCumulusId].map((executionId) => ({
      granule_cumulus_id: Number(granuleCumulusId),
      execution_cumulus_id: executionId,
    }))
  );
});

test('getApiGranuleExecutionCumulusIds() returns correct values', async (t) => {
  const {
    knex,
    collection,
    collectionCumulusId,
    collectionPgModel,
    executionCumulusId,
    executionPgModel,
    granulePgModel,
    granulesExecutionsPgModel,
  } = t.context;

  const collectionId = constructCollectionId(collection.name, collection.version);

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'completed',
  });

  await knex.transaction(
    (trx) => upsertGranuleWithExecutionJoinRecord(
      trx,
      granule,
      executionCumulusId
    )
  );

  const [secondExecutionCumulusId] = await executionPgModel.create(
    knex,
    fakeExecutionRecordFactory()
  );

  await knex.transaction(
    (trx) => upsertGranuleWithExecutionJoinRecord(
      trx,
      granule,
      secondExecutionCumulusId
    )
  );

  const granules = [
    {
      granuleId: granule.granule_id,
      collectionId,
    },
  ];

  const results = await getApiGranuleExecutionCumulusIds(
    knex,
    granules,
    collectionPgModel,
    granulePgModel,
    granulesExecutionsPgModel
  );

  t.deepEqual(results.sort(), [executionCumulusId, secondExecutionCumulusId].sort());
});

test('getApiGranuleExecutionCumulusIds() only queries DB when collection is not in map', async (t) => {
  const {
    knex,
    collection,
    collectionCumulusId,
    collectionPgModel,
    executionCumulusId,
    executionPgModel,
    granulePgModel,
    granulesExecutionsPgModel,
  } = t.context;

  const getCollectionRecordCumulusIdSpy = sinon.spy(CollectionPgModel.prototype, 'getRecordCumulusId');

  t.teardown(() => {
    getCollectionRecordCumulusIdSpy.restore();
  });

  const collectionId = constructCollectionId(collection.name, collection.version);

  const granule1 = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'completed',
  });

  const granule2 = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    status: 'running',
  });

  await knex.transaction(
    (trx) => upsertGranuleWithExecutionJoinRecord(
      trx,
      granule1,
      executionCumulusId
    )
  );

  const [secondExecutionCumulusId] = await executionPgModel.create(
    knex,
    fakeExecutionRecordFactory()
  );

  await knex.transaction(
    (trx) => upsertGranuleWithExecutionJoinRecord(
      trx,
      granule1,
      secondExecutionCumulusId
    )
  );

  await knex.transaction(
    (trx) => upsertGranuleWithExecutionJoinRecord(
      trx,
      granule2,
      secondExecutionCumulusId
    )
  );

  const granules = [
    {
      granuleId: granule1.granule_id,
      collectionId,
    },
    {
      granuleId: granule2.granule_id,
      collectionId,
    },
  ];

  const { name, version } = deconstructCollectionId(collectionId);
  // we should only query collection once since the two granules have the same collection
  t.true(getCollectionRecordCumulusIdSpy.calledOnceWith(knex, { name, version }));

  const results = await getApiGranuleExecutionCumulusIds(
    knex,
    granules,
    collectionPgModel,
    granulePgModel,
    granulesExecutionsPgModel
  );

  t.deepEqual(results.sort(), [executionCumulusId, secondExecutionCumulusId].sort());
});

test('getUniqueGranuleByGranuleId() returns a single granule', async (t) => {
  const {
    knex,
    collectionCumulusId,
    granulePgModel,
  } = t.context;

  const fakeGranule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });
  const [granuleCumulusId] = await granulePgModel.create(knex, fakeGranule);

  const pgGranule = await granulePgModel.get(knex, { cumulus_id: granuleCumulusId });

  t.deepEqual(
    await getUniqueGranuleByGranuleId(knex, pgGranule.granule_id, granulePgModel),
    pgGranule
  );
});

test('getUniqueGranuleByGranuleId() throws an error if more than one granule is found', async (t) => {
  const {
    knex,
    collectionCumulusId,
    collectionPgModel,
    granulePgModel,
  } = t.context;

  const granuleId = 1;

  const collection = fakeCollectionRecordFactory({ name: 'collectionName2', version: 'collectionVersion2' });
  const [collectionPgRecord] = await collectionPgModel.create(knex, collection);
  const collectionCumulusId2 = collectionPgRecord.cumulus_id;

  // 2 records. Same granule ID, different collections
  const fakeGranules = [
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      granule_id: granuleId,
    }),
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId2,
      granule_id: granuleId,
    }),
  ];

  const granuleIds = await Promise.all(fakeGranules.map((fakeGranule) =>
    granulePgModel.create(knex, fakeGranule)));

  const pgGranule = await granulePgModel.get(knex, { cumulus_id: granuleIds[0][0] });

  await t.throwsAsync(
    getUniqueGranuleByGranuleId(knex, pgGranule.granule_id, granulePgModel),
    { instanceOf: Error }
  );
});

test('getUniqueGranuleByGranuleId() throws an error if no granules are found', async (t) => {
  const {
    knex,
    granulePgModel,
  } = t.context;

  await t.throwsAsync(
    getUniqueGranuleByGranuleId(knex, 99999, granulePgModel),
    { instanceOf: RecordDoesNotExist }
  );
});
