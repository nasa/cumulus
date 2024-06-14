const test = require('ava');
const {
  CollectionPgModel,
  ProviderPgModel,
  ExecutionPgModel,
  fakeCollectionRecordFactory,
  fakeProviderRecordFactory,
  migrationDir,
  generateLocalTestDb,
  destroyLocalTestDb,
  GranulePgModel,
  FilePgModel,
  GranulesExecutionsPgModel,
} = require('@cumulus/db');
const { randomId } = require('@cumulus/common/test-utils');
const { randomInt } = require('crypto');
const {
  loadCollection,
  loadProvider,
  loadGranulesExecutions,
  loadGranules,
  loadExecutions,
  loadFiles,
  loadRule,
} = require('../db_record_loaders');
test.before(async (t) => {
  t.context.testDbName = randomId('generate_records');
  const { knex, knexAdmin } = await generateLocalTestDb(t.context.testDbName, migrationDir);

  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
  t.context.collectionCumulusId = await loadCollection(knex, 5);
  t.context.providerCumulusId = await loadProvider(knex);
});
test.after.always(async (t) => {
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    tesetDbName: t.context.testDbName,
  });
});

test('loadExecutions() uploads executions', async (t) => {
  const executionModel = new ExecutionPgModel();
  const executions = await loadExecutions(
    t.context.knex,
    t.context.collectionCumulusId,
    3,
    executionModel
  );
  t.is(executions.length, 3);
  await Promise.all(executions.map(async (execution) => {
    await executionModel.exists(t.context.knex, { cumulus_id: execution });
  }));
});

test('loadGranules() uploads granules', async (t) => {
  const granuleModel = new GranulePgModel();

  let granules = await loadGranules(
    t.context.knex,
    t.context.collectionCumulusId,
    t.context.providerCumulusId,
    15,
    granuleModel
  );
  t.is(granules.length, 15);
  await Promise.all(granules.map(async (granule) => {
    t.true(await granuleModel.exists(t.context.knex, { cumulus_id: granule }));
  }));
  granules = await loadGranules(
    t.context.knex,
    t.context.collectionCumulusId,
    t.context.providerCumulusId,
    5,
    granuleModel
  );
  t.is(granules.length, 5);
  await Promise.all(granules.map(async (granule) => {
    t.true(await granuleModel.exists(t.context.knex, { cumulus_id: granule }));
  }));
});

test('loadFiles() uploadsFiles', async (t) => {
  const granuleModel = new GranulePgModel();
  const fileModel = new FilePgModel();
  const [granuleCumulusId] = await loadGranules(
    t.context.knex,
    t.context.collectionCumulusId,
    t.context.providerCumulusId,
    1,
    granuleModel
  );
  const filesUploaded = await loadFiles(
    t.context.knex,
    granuleCumulusId,
    12,
    fileModel
  );
  await Promise.all(filesUploaded.map(async (file) => {
    t.true(await fileModel.exists(t.context.knex, { cumulus_id: file }));
  }));
});

test('loadGranulesExecutions() uploads GranulesExecutions', async (t) => {
  const granuleModel = new GranulePgModel();
  const executionModel = new ExecutionPgModel();
  const geModel = new GranulesExecutionsPgModel();
  const granuleCumulusIds = await loadGranules(
    t.context.knex,
    t.context.collectionCumulusId,
    t.context.providerCumulusId,
    12,
    granuleModel
  );
  const executionCumulusIds = await loadExecutions(
    t.context.knex,
    t.context.collectionCumulusId,
    15,
    executionModel
  );
  const geUploads = await loadGranulesExecutions(
    t.context.knex,
    granuleCumulusIds,
    executionCumulusIds,
    geModel
  );
  await Promise.all(geUploads.map(async (granuleExecution) => {
    t.true(await geModel.exists(t.context.knex, granuleExecution));
  }));
});

test('loadRule() adds a rule and accepts undefined collection/provider ids', async (t) => {
  await loadRule(
    t.context.knex,
    t.context.collectionCumulusId,
    t.context.providerCumulusId
  );
  t.pass();
});
