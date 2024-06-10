const test = require('ava');
const clone = require('lodash/clone');
const pMap = require('p-map');
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
const {
  yieldCollectionDetails,
  uploadExecutions,
  uploadGranules,
  uploadFiles,
  uploadGranuleExecutions,
  getDetailGenerator,
  parseArgs,
  uploadDBGranules,
} = require('../generate_db_records');
const { postRecoverCumulusMessages } = require('../../../packages/api/endpoints/dead-letter-archive');

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
  await Promise.all(executions.map(async (execution) => {
    await executionModel.exists(t.context.knex, { cumulus_id: execution });
  }));
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
  t.is(granules.length, 15);
  await Promise.all(granules.map(async (granule) => {
    await granuleModel.exists(t.context.knex, { cumulus_id: granule });
  }));
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
  await Promise.all(granules.map(async (granule) => {
    await granuleModel.exists(t.context.knex, { cumulus_id: granule });
  }));
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
    'abc',
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

test('getDetailGenerator() yields a generator that plays well with pMap', async (t) => {
  let iterated = 0;
  const iterableGenerator = getDetailGenerator({
    knex: {},
    granules: 5,
    collectionCumulusId: 0,
    providerCumulusId: 0,
    filesPerGranule: 0,
    granulesPerBatch: 1,
    executionsPerBatch: 0,
    models: {},
    variance: false,
  });
  await pMap(
    iterableGenerator,
    () => {
      iterated += 1;
    },
    { concurrency: 1 }
  );
  t.is(iterated, 5);
});
const setArgs = (args) => {
  process.argv = process.argv.slice(0, 2).concat(args);
};
test.serial('parseArgs() parses out arguments when given reasonable args', (t) => {
  const argv = clone(process.argv);
  const env = clone(process.env);
  process.env.DEPLOYMENT = 'test';
  process.env.INTERNAL_BUCKET = 'test';
  setArgs([]);
  let args = parseArgs();
  const defaultArgs = {
    granules: 10000,
    files: 1,
    collections: 1,
    executionsPerBatch: 2,
    granulesPerBatch: 2,
    variance: false,
    concurrency: 1,
    deployment: 'test',
    internalBucket: 'test',
  };
  t.deepEqual(args, defaultArgs);

  setArgs([
    '--collections=3',
    '--files=4',
    '--concurrency', '5',
    '--executionsPerGranule=3:5',
    '--variance=true',
    '--granules=112',
  ]);
  args = parseArgs();
  t.deepEqual(args, {
    granules: 112000,
    files: 4,
    concurrency: 5,
    executionsPerBatch: 3,
    granulesPerBatch: 5,
    variance: true,
    collections: 3,
    deployment: 'test',
    internalBucket: 'test',
  });

  setArgs([
    '--concurrency=12',
  ]);
  args = parseArgs();
  t.deepEqual(args, {
    ...defaultArgs,
    concurrency: 12,
  });

  setArgs([
    '--files_per_gran=12',
  ]);
  args = parseArgs();
  t.deepEqual(args, {
    ...defaultArgs,
    files: 12,
  });

  setArgs([
    '--num_collections=3',
  ]);
  args = parseArgs();
  t.deepEqual(args, {
    ...defaultArgs,
    collections: 3,
  });

  setArgs([
    '--granulesK=15',
  ]);
  args = parseArgs();
  t.deepEqual(args, {
    ...defaultArgs,
    granules: 15000,
  });

  setArgs([
    '--granules_k=15',
  ]);
  args = parseArgs();
  t.deepEqual(args, {
    ...defaultArgs,
    granules: 15000,
  });

  setArgs([
    '--executions_to_granule=4:5',
  ]);
  args = parseArgs();
  t.deepEqual(args, {
    ...defaultArgs,
    executionsPerBatch: 4,
    granulesPerBatch: 5,
  });

  setArgs([
    '--executions_per_granule=6:5',
  ]);
  args = parseArgs();
  t.deepEqual(args, {
    ...defaultArgs,
    executionsPerBatch: 6,
    granulesPerBatch: 5,
  });

  setArgs([
    '--executions_to_granules=12:5',
  ]);
  args = parseArgs();
  t.deepEqual(args, {
    ...defaultArgs,
    executionsPerBatch: 12,
    granulesPerBatch: 5,
  });

  process.argv = argv;
  process.env = env;
});

test.serial("parseArgs() fails when executionsPerGranule doesn't follow a:b format", (t) => {
  const argv = clone(process.argv);
  setArgs([
    '--executionsPerGranule=35',
  ]);
  t.throws(
    parseArgs,
    { message: 'cannot parse 35, expected format <executions>:<granules> ratio \nError: only 1 value could be split from 35' }
  );
  process.argv = argv;
});

test('uploadDBGranules() uploads a pile of entries', async (t) => {
  const providerPgModel = new ProviderPgModel();
  const collectionPgModel = new CollectionPgModel();

  const collectionRecord = fakeCollectionRecordFactory({
    name: 'MOD09GQ_abc',
    version: '007',
  });
  const providerRecord = fakeProviderRecordFactory();
  await providerPgModel.create(t.context.knex, providerRecord);
  await collectionPgModel.create(
    t.context.knex,
    collectionRecord
  );
  await uploadDBGranules(
    t.context.knex,
    providerRecord.name,
    collectionRecord,
    100,
    2,
    3,
    2,
    2,
    1
  );
  t.pass();
});
