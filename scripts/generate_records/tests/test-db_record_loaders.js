const test = require('ava');
const {
  ExecutionPgModel,
  migrationDir,
  generateLocalTestDb,
  destroyLocalTestDb,
  GranulePgModel,
  FilePgModel,
  GranulesExecutionsPgModel,
  CollectionPgModel,
  ProviderPgModel,
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
  t.context.testDbName = randomId('db_record_loaders');
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
    t.true(await executionModel.exists(t.context.knex, { cumulus_id: execution }));
  }));
  const paramedExecutions = await loadExecutions(
    t.context.knex,
    t.context.collectionCumulusId,
    2,
    executionModel,
    { original_payload: { a: 'b' }, final_payload: { c: 'd' } }
  );
  await Promise.all(paramedExecutions.map(async (execution) => {
    const exec = await executionModel.get(t.context.knex, { cumulus_id: execution });
    t.deepEqual(exec.final_payload, { c: 'd' });
    t.deepEqual(exec.original_payload, { a: 'b' });
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
    granuleModel,
    { duration: 5 }
  );
  t.is(granules.length, 5);
  await Promise.all(granules.map(async (granule) => {
    t.is((await granuleModel.get(t.context.knex, { cumulus_id: granule })).duration, 5);
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
  const paramFilesUploaded = await loadFiles(
    t.context.knex,
    granuleCumulusId,
    12,
    fileModel,
    { bucket: 'a' }
  );
  await Promise.all(paramFilesUploaded.map(async (file) => {
    t.is((await fileModel.get(t.context.knex, { cumulus_id: file })).bucket, 'a');
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
test('loadCollection() adds collections', async (t) => {
  //this test is largely redundant to all the above tests that demand this works to function
  for (const collectionNumber of new Array(12)) {
    const numberOfFiles = randomInt(5);
    // eslint-disable-next-line no-await-in-loop
    await loadCollection(t.context.knex, numberOfFiles, collectionNumber);
  }
  const collectionModel = new CollectionPgModel();
  const randomizedCollectionId = await loadCollection(t.context.knex, 12);
  t.true((await collectionModel.exists(t.context.knex, { cumulus_id: randomizedCollectionId })));

  const parameterizedCollectionId = await loadCollection(t.context.knex, 12, 1, { duplicate_handling: 'replace' });

  t.is((await collectionModel.get(t.context.knex, { cumulus_id: parameterizedCollectionId })).duplicate_handling, 'replace');
});

test('loadProvider() adds a provider', async (t) => {
  //this test is largely redundant to all the above tests that demand this works to function
  const providerId = await loadProvider(t.context.knex, { name: 'abcd' });

  const providerModel = new ProviderPgModel();
  t.is((await providerModel.get(t.context.knex, { cumulus_id: providerId })).name, 'abcd');
});

test('loadRule() adds a rule and accepts undefined collection/provider ids', async (t) => {
  await loadRule(
    t.context.knex,
    t.context.collectionCumulusId,
    t.context.providerCumulusId
  );
  t.pass();
});
