const test = require('ava');
const pMap = require('p-map');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const { createBucket } = require('@cumulus/aws-client/S3');
const {
  CollectionPgModel,
  ProviderPgModel,
  getKnexClient,
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
const {
  yieldCollectionDetails,
  uploadExecutions,
  uploadGranules,
  uploadFiles,
  uploadGranuleExecutions,
  ParameterGenerator,
} = require('../generate_db_records');


test('yieldCollectionDetails() gives repeatable and non-repeatable collections with valid name, version and suffix', (t) => {
  const numberOfCollections = 120;
  const repeatableCollections = [];
  for (const collection of yieldCollectionDetails(numberOfCollections, true)) {
    repeatableCollections.push(collection);
  }
  t.is(repeatableCollections.length, numberOfCollections);
  for (let i = 0; i < repeatableCollections.length; i += 1) {
    t.is(repeatableCollections[i].version, '006');
    t.true(repeatableCollections[i].name.startsWith('MOD09GQ_test'));
    t.true(repeatableCollections[i].name.endsWith(`${i}`));
    t.true(repeatableCollections[i].name.endsWith(repeatableCollections[i].suffix));
  }
  const nonRepeatableCollections = [];
  for (const collection of yieldCollectionDetails(numberOfCollections, false)) {
    nonRepeatableCollections.push(collection);
  }

  t.is(nonRepeatableCollections.length, numberOfCollections);
  for (let i = 0; i < nonRepeatableCollections.length; i += 1) {
    t.is(repeatableCollections[i].version, '006');
    t.true(nonRepeatableCollections[i].name.startsWith('MOD09GQ_'));
    t.true(nonRepeatableCollections[i].name.endsWith(nonRepeatableCollections[i].suffix));
  }
});
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
// test('addCollection()', (t) => {
//   // i'm not sure how to test this without significant rearrange
//   t.pass();
// });

// test('adProvider()', (t) => {
//   // i'm not sure how to test this without significant rearrange
//   t.pass();
// });

test('uploadExecutions() uploads executions', async (t) => {
  const collectionModel = new CollectionPgModel();
  const executionModel = new ExecutionPgModel();
  const dbCollection = await collectionModel.get(
    t.context.knex,
    { name: 'MOD09GQ_abc', version: '006' }
  );
  const executions = await uploadExecutions(
    t.context.knex,
    dbCollection.cumulus_id,
    3,
    {
      executionModel,
    }
  );
  t.is(executions.length, 3);
});

test('uploadGranules() uploads granules', async (t) => {
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
  let granules = await uploadGranules(
    t.context.knex,
    dbCollection.cumulus_id,
    dbProvider.cumulus_id,
    15,
    0,
    {
      granuleModel,
    }
  );
  t.is(granules.length, 15)

  granules = await uploadGranules(
    t.context.knex,
    dbCollection.cumulus_id,
    dbProvider.cumulus_id,
    5,
    5,
    {
      granuleModel,
      fileModel,
    }
  );
  t.is(granules.length, 5);
});

test('uploadFiles() uploadsFiles', async (t) => {
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
  const [granuleCumulusId] = await uploadGranules(
    t.context.knex,
    dbCollection.cumulus_id,
    dbProvider.cumulus_id,
    1,
    0,
    {
      granuleModel,
    }
  );
  const filesUploaded = await uploadFiles(
    t.context.knex,
    granuleCumulusId,
    12,
    {
      fileModel,
    }
  );
  t.is(filesUploaded, 12);
});

test('uploadGranuleExecutions() uploads GranuleExecutions', async (t) => {
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
  const granuleCumulusIds = await uploadGranules(
    t.context.knex,
    dbCollection.cumulus_id,
    dbProvider.cumulus_id,
    12,
    0,
    {
      granuleModel,
    }
  );
  const executionCumulusIds = await uploadExecutions(
    t.context.knex,
    dbCollection.cumulus_id,
    15,
    {
      executionModel,
    }
  );
  const geUploads = await uploadGranuleExecutions(
    t.context.knex,
    granuleCumulusIds,
    executionCumulusIds,
    {
      geModel,
    }
  );
  t.is(geUploads, 15 * 12);
});

test.only('getDetailGenerator() yields a generator that plays well with pMap', async (t) => {
  let iterated = 0;
  const iterableGenerator = new ParameterGenerator(
    {},
    5,
    0, 0, 0, 0, 0, {}, false
  );
  console.log('got iterableGenerator')
  await pMap(
    iterableGenerator,
    (data) => {
      console.log('iterated:', data);
      iterated += 1;
    },
    { concurrency: 1 }
  );
  t.is(iterated, 5);
t.pass()
});
