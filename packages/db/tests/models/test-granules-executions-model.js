const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  CollectionPgModel,
  destroyLocalTestDb,
  ExecutionPgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeGranuleRecordFactory,
  generateLocalTestDb,
  GranulePgModel,
  GranulesExecutionsPgModel,
  TableNames,
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
  const [pgCollection] = await collectionPgModel.create(
    t.context.knex,
    fakeCollectionRecordFactory()
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
  const [pgGranule] = await t.context.granulePgModel.create(
    t.context.knex,
    fakeGranuleRecordFactory({
      collection_cumulus_id: t.context.collectionCumulusId,
    })
  );
  t.context.granuleCumulusId = pgGranule.cumulus_id;
  t.context.joinRecord = {
    execution_cumulus_id: t.context.executionCumulusId,
    granule_cumulus_id: t.context.granuleCumulusId,
  };
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('GranulesExecutionsPgModel.create() creates a new granule/execution join record', async (t) => {
  const {
    knex,
    granulesExecutionsPgModel,
    joinRecord,
  } = t.context;

  t.plan(1);

  await createRejectableTransaction(knex, async (trx) => {
    await granulesExecutionsPgModel.create(trx, joinRecord);
    const records = await trx(TableNames.granulesExecutions).where(joinRecord);
    t.is(
      records.length,
      1
    );
  });
});

test('GranulesExecutionsPgModel.exists() correctly returns true', async (t) => {
  const {
    knex,
    granulesExecutionsPgModel,
    joinRecord,
  } = t.context;

  t.plan(1);

  await createRejectableTransaction(knex, async (trx) => {
    await granulesExecutionsPgModel.create(trx, joinRecord);
    t.true(
      await granulesExecutionsPgModel.exists(trx, joinRecord)
    );
  });
});

test.serial('GranulesExecutionsPgModel.exists() correctly returns false', async (t) => {
  const {
    knex,
    granulesExecutionsPgModel,
  } = t.context;

  t.plan(1);

  await createRejectableTransaction(knex, async (trx) => {
    t.false(
      await granulesExecutionsPgModel.exists(trx, {
        execution_cumulus_id: 5,
        granule_cumulus_id: 5,
      })
    );
  });
});

test('GranulesExecutionsPgModel.upsert() creates a new granule/execution join record', async (t) => {
  const {
    knex,
    granulesExecutionsPgModel,
    joinRecord,
  } = t.context;

  t.plan(1);

  await createRejectableTransaction(knex, async (trx) => {
    await granulesExecutionsPgModel.upsert(trx, joinRecord);
    const records = await trx(TableNames.granulesExecutions).where(joinRecord);
    t.is(
      records.length,
      1
    );
  });
});

test('GranulesExecutionsPgModel.upsert() overwrites a new granule/execution join record', async (t) => {
  const {
    knex,
    granulesExecutionsPgModel,
    joinRecord,
  } = t.context;

  t.plan(2);

  await createRejectableTransaction(knex, async (trx) => {
    await granulesExecutionsPgModel.upsert(trx, joinRecord);
    t.true(await granulesExecutionsPgModel.exists(trx, joinRecord));
    await granulesExecutionsPgModel.upsert(trx, joinRecord);
    t.true(await granulesExecutionsPgModel.exists(trx, joinRecord));
  });
});

test('GranulesExecutionsPgModel.search() returns all granule/execution join records matching query', async (t) => {
  const {
    knex,
    executionPgModel,
    granulesExecutionsPgModel,
    executionCumulusId,
    joinRecord,
  } = t.context;

  t.plan(1);

  await createRejectableTransaction(knex, async (trx) => {
    await granulesExecutionsPgModel.create(trx, joinRecord);
    const [newExecution] = await executionPgModel.create(
      trx,
      fakeExecutionRecordFactory()
    );
    const newExecutionCumulusId = newExecution.cumulus_id;

    await granulesExecutionsPgModel.create(trx, {
      ...joinRecord,
      execution_cumulus_id: newExecutionCumulusId,
    });

    t.deepEqual(
      await granulesExecutionsPgModel.search(trx, {
        granule_cumulus_id: joinRecord.granule_cumulus_id,
      }),
      [executionCumulusId, newExecutionCumulusId].map((executionId) => ({
        execution_cumulus_id: executionId,
        granule_cumulus_id: joinRecord.granule_cumulus_id,
      }))
    );
  });
});

test('GranulesExecutionsPgModel.searchByGranuleCumulusIds() returns correct values', async (t) => {
  const {
    knex,
    executionPgModel,
    granulesExecutionsPgModel,
    executionCumulusId,
    joinRecord,
  } = t.context;
  let newExecutionCumulusId;
  await createRejectableTransaction(knex, async (trx) => {
    await granulesExecutionsPgModel.create(trx, joinRecord);
    const [pgExecution] = await executionPgModel.create(
      trx,
      fakeExecutionRecordFactory()
    );
    newExecutionCumulusId = pgExecution.cumulus_id;

    await granulesExecutionsPgModel.create(trx, {
      ...joinRecord,
      execution_cumulus_id: newExecutionCumulusId,
    });
  });

  const results = await granulesExecutionsPgModel
    .searchByGranuleCumulusIds(knex, [joinRecord.granule_cumulus_id]);

  t.deepEqual(results.sort(), [executionCumulusId, newExecutionCumulusId].sort());
});

test('GranulesExecutionsPgModel.searchByGranuleCumulusIds() works with a transaction', async (t) => {
  const {
    knex,
    executionPgModel,
    granulesExecutionsPgModel,
    executionCumulusId,
    joinRecord,
  } = t.context;
  await createRejectableTransaction(knex, async (trx) => {
    await granulesExecutionsPgModel.create(trx, joinRecord);
    const [newExecution] = await executionPgModel.create(
      trx,
      fakeExecutionRecordFactory()
    );
    const newExecutionCumulusId = newExecution.cumulus_id;

    await granulesExecutionsPgModel.create(trx, {
      ...joinRecord,
      execution_cumulus_id: newExecutionCumulusId,
    });

    const results = await granulesExecutionsPgModel
      .searchByGranuleCumulusIds(trx, [joinRecord.granule_cumulus_id]);

    t.deepEqual(results.sort(), [executionCumulusId, newExecutionCumulusId].sort());
  });
});

test('GranulesExecutionsPgModel.delete() correctly deletes records', async (t) => {
  const {
    knex,
    granulesExecutionsPgModel,
    joinRecord,
  } = t.context;

  let actual;
  await createRejectableTransaction(knex, async (trx) => {
    await granulesExecutionsPgModel.create(trx, joinRecord);
    await granulesExecutionsPgModel.delete(trx, joinRecord);
    actual = await granulesExecutionsPgModel.search(trx, joinRecord);
  });

  t.deepEqual(actual, []);
});
