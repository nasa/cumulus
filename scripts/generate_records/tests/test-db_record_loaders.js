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
  yieldCollectionDetails,
} = require('../generate_db_records');
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
  const collectionModel = new CollectionPgModel();
  await collectionModel.create(
    t.context.knex,
    fakeCollectionRecordFactory({
      name: 'MOD09GQ_abc',
      version: '006',
    })
  );
  const providerPgModel = new ProviderPgModel();
  providerPgModel.create(
    t.context.knex,
    fakeProviderRecordFactory({ name: 'provider_test' })
  );
});
test.after.always(async (t) => {
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    tesetDbName: t.context.testDbName,
  });
});

test('loadExecutions() uploads executions', async (t) => {
  const collectionModel = new CollectionPgModel();
  const executionModel = new ExecutionPgModel();
  const dbCollection = await collectionModel.get(
    t.context.knex,
    { name: 'MOD09GQ_abc', version: '006' }
  );
  const executions = await loadExecutions(
    t.context.knex,
    dbCollection.cumulus_id,
    3,
    executionModel
  );
  t.is(executions.length, 3);
  await Promise.all(executions.map(async (execution) => {
    await executionModel.exists(t.context.knex, { cumulus_id: execution });
  }));
});

test('loadGranules() uploads granules', async (t) => {
  const collectionModel = new CollectionPgModel();
  const providerModel = new ProviderPgModel();
  const granuleModel = new GranulePgModel();
  const dbCollection = await collectionModel.get(
    t.context.knex,
    { name: 'MOD09GQ_abc', version: '006' }
  );
  const dbProvider = await providerModel.get(
    t.context.knex,
    { name: 'provider_test' }
  );
  let granules = await loadGranules(
    t.context.knex,
    dbCollection.cumulus_id,
    dbProvider.cumulus_id,
    15,
    granuleModel
  );
  t.is(granules.length, 15);
  await Promise.all(granules.map(async (granule) => {
    t.true(await granuleModel.exists(t.context.knex, { cumulus_id: granule }));
  }));
  granules = await loadGranules(
    t.context.knex,
    dbCollection.cumulus_id,
    dbProvider.cumulus_id,
    5,
    granuleModel
  );
  t.is(granules.length, 5);
  await Promise.all(granules.map(async (granule) => {
    t.true(await granuleModel.exists(t.context.knex, { cumulus_id: granule }));
  }));
});

test('loadFiles() uploadsFiles', async (t) => {
  const collectionModel = new CollectionPgModel();
  const providerModel = new ProviderPgModel();
  const granuleModel = new GranulePgModel();
  const fileModel = new FilePgModel();
  const dbCollection = await collectionModel.get(
    t.context.knex,
    { name: 'MOD09GQ_abc', version: '006' }
  );
  const dbProvider = await providerModel.get(
    t.context.knex,
    { name: 'provider_test' }
  );
  const [granuleCumulusId] = await loadGranules(
    t.context.knex,
    dbCollection.cumulus_id,
    dbProvider.cumulus_id,
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
  const collectionModel = new CollectionPgModel();
  const providerModel = new ProviderPgModel();
  const granuleModel = new GranulePgModel();
  const executionModel = new ExecutionPgModel();
  const geModel = new GranulesExecutionsPgModel();
  const dbCollection = await collectionModel.get(
    t.context.knex,
    { name: 'MOD09GQ_abc', version: '006' }
  );
  const dbProvider = await providerModel.get(
    t.context.knex,
    { name: 'provider_test' }
  );
  const granuleCumulusIds = await loadGranules(
    t.context.knex,
    dbCollection.cumulus_id,
    dbProvider.cumulus_id,
    12,
    granuleModel
  );
  const executionCumulusIds = await loadExecutions(
    t.context.knex,
    dbCollection.cumulus_id,
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
  for (const collection of yieldCollectionDetails(10, true)) {
    const numberOfFiles = randomInt(5);
    // eslint-disable-next-line no-await-in-loop
    const pgCollection = await loadCollection(t.context.knex, collection.name, numberOfFiles);
    t.is(pgCollection.files.length, numberOfFiles);
    t.is(pgCollection.name, collection.name);
  }
  for (const collection of yieldCollectionDetails(10, false)) {
    const numberOfFiles = randomInt(5);
    // eslint-disable-next-line no-await-in-loop
    const pgCollection = await loadCollection(t.context.knex, collection.name, numberOfFiles);
    t.is(pgCollection.files.length, numberOfFiles);
    t.is(pgCollection.name, collection.name);
  }
});

test('loadProvider() adds a provider', async (t) => {
  await loadProvider(t.context.knex);
  t.pass();
});

test('loadRule() adds a rule and accepts undefined collection/provider ids', async (t) => {
  await loadRule(t.context.knex);
  await loadRule(t.context.knex, 1, 2);
  t.pass();
});
