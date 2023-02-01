const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  CollectionPgModel,
  ExecutionPgModel,
  PdrPgModel,
  ProviderPgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeProviderRecordFactory,
  fakePdrRecordFactory,
  TableNames,
  generateLocalTestDb,
  destroyLocalTestDb,
  migrationDir,
} = require('../../dist');

const testDbName = `pdr_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.pdrPgModel = new PdrPgModel();

  const collectionPgModel = new CollectionPgModel();
  const [pgCollection] = await collectionPgModel.create(
    t.context.knex,
    fakeCollectionRecordFactory()
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;

  t.context.executionPgModel = new ExecutionPgModel();
  const [pgExecution] = await t.context.executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory()
  );
  const executionCumulusId = pgExecution.cumulus_id;
  t.context.executionCumulusId = executionCumulusId;

  const providerPgModel = new ProviderPgModel();
  const [pgProvider] = await providerPgModel.create(
    t.context.knex,
    fakeProviderRecordFactory()
  );
  t.context.providerCumulusId = pgProvider.cumulus_id;
});

test.beforeEach((t) => {
  t.context.pdrRecord = fakePdrRecordFactory({
    collection_cumulus_id: t.context.collectionCumulusId,
    execution_cumulus_id: t.context.executionCumulusId,
    provider_cumulus_id: t.context.providerCumulusId,
  });
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('PdrPgModel.upsert() does not update record with same execution if progress is less than current', async (t) => {
  const {
    knex,
    pdrPgModel,
    pdrRecord,
  } = t.context;

  pdrRecord.status = 'running';
  pdrRecord.progress = 75;
  const [insertResult] = await knex(TableNames.pdrs)
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

test('PdrPgModel.upsert() overwrites record with same execution if progress is greater than current', async (t) => {
  const {
    knex,
    pdrPgModel,
    pdrRecord,
  } = t.context;

  pdrRecord.status = 'running';
  pdrRecord.progress = 25;
  const [insertResult] = await knex(TableNames.pdrs)
    .insert(pdrRecord)
    .returning('*');
  t.is(insertResult.progress, 25);

  // Update PDR progress
  const updatedRecord = {
    ...pdrRecord,
    progress: 100,
  };

  await pdrPgModel.upsert(knex, updatedRecord);

  t.like(
    await pdrPgModel.get(knex, { name: pdrRecord.name }),
    updatedRecord
  );
});

test('PdrPgModel.upsert() updates a "completed" record to "running" if execution is different and created_at is newer', async (t) => {
  const {
    knex,
    executionPgModel,
    pdrPgModel,
    pdrRecord,
  } = t.context;

  const testDate = Date.now();

  pdrRecord.status = 'completed';
  pdrRecord.created_at = new Date(testDate);

  const [insertResult] = await knex(TableNames.pdrs)
    .insert(pdrRecord)
    .returning('*');
  t.is(insertResult.status, 'completed');

  // Update PDR status and execution
  const [pgExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory()
  );
  const executionCumulusId = pgExecution.cumulus_id;
  const updatedRecord = {
    ...pdrRecord,
    status: 'running',
    execution_cumulus_id: executionCumulusId,
    created_at: new Date(testDate + 10000),
  };

  await pdrPgModel.upsert(knex, updatedRecord);

  t.like(
    await pdrPgModel.get(knex, { name: pdrRecord.name }),
    updatedRecord
  );
});

test('PdrPgModel.upsert() does not update a "completed" record to "running" if execution is different and created_at is older', async (t) => {
  const {
    knex,
    executionPgModel,
    pdrPgModel,
    pdrRecord,
  } = t.context;

  const testDate = Date.now();

  pdrRecord.status = 'completed';
  pdrRecord.created_at = new Date(testDate);

  const [insertResult] = await knex(TableNames.pdrs)
    .insert(pdrRecord)
    .returning('*');
  t.is(insertResult.status, 'completed');

  // Update PDR status and execution
  const [pgExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory()
  );
  const executionCumulusId = pgExecution.cumulus_id;
  const updatedRecord = {
    ...pdrRecord,
    status: 'running',
    execution_cumulus_id: executionCumulusId,
    created_at: new Date(testDate - 10000),
  };

  await pdrPgModel.upsert(knex, updatedRecord);

  t.like(
    await pdrPgModel.get(knex, { name: pdrRecord.name }),
    pdrRecord
  );
});

test('PdrPgModel.upsert() does not update a final (failed) record to a final state (completed) if execution is different but created_at is older', async (t) => {
  const {
    knex,
    executionPgModel,
    pdrPgModel,
    pdrRecord,
  } = t.context;

  const testDate = Date.now();

  pdrRecord.status = 'failed';
  pdrRecord.created_at = new Date(testDate);

  const [insertResult] = await knex(TableNames.pdrs)
    .insert(pdrRecord)
    .returning('*');
  t.is(insertResult.status, 'failed');

  // Update PDR status and execution
  const [pgExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory()
  );
  const executionCumulusId = pgExecution.cumulus_id;
  const updatedRecord = {
    ...pdrRecord,
    status: 'completed',
    execution_cumulus_id: executionCumulusId,
    created_at: new Date(testDate - 10000),
  };

  await pdrPgModel.upsert(knex, updatedRecord);

  t.like(
    await pdrPgModel.get(knex, { name: pdrRecord.name }),
    pdrRecord
  );
});

test('PdrPgModel.upsert() does update a final (failed) record to a final state (completed) if execution is different but created_at is newer', async (t) => {
  const {
    knex,
    executionPgModel,
    pdrPgModel,
    pdrRecord,
  } = t.context;

  const testDate = Date.now();

  pdrRecord.status = 'failed';
  pdrRecord.created_at = new Date(testDate);

  const [insertResult] = await knex(TableNames.pdrs)
    .insert(pdrRecord)
    .returning('*');
  t.is(insertResult.status, 'failed');

  // Update PDR status and execution
  const [pgExecution] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory()
  );
  const executionCumulusId = pgExecution.cumulus_id;
  const updatedRecord = {
    ...pdrRecord,
    status: 'completed',
    execution_cumulus_id: executionCumulusId,
    created_at: new Date(testDate + 100000),
  };

  await pdrPgModel.upsert(knex, updatedRecord);

  t.like(
    await pdrPgModel.get(knex, { name: pdrRecord.name }),
    updatedRecord
  );
});
